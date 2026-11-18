"use client";

// The Hollow map: one level at a time, like a city map. Data flow:
//   useUndercurrent (hubs, live) → adapter (MapEvent) ┐
//   model (generated world, water solver)            ├→ CityScene (draws) + panels (explain)
// The map shows what happened; the hub's checks and counters (console) prove it.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { summary, timeAgo } from "@/lib/format";
import { useUndercurrent, type Undercurrent } from "@/lib/useUndercurrent";
import { adaptEvents, SEVERITY_LABEL, SEVERITY_RANK, summarize, type MapEvent } from "./adapter";
import {
  addLevel, buildingById, createWorld, cutOffBuildings, destinations, floodedEdges, safeRoute, FACILITY_USES, levelOf, MAX_LEVEL, MIN_LEVEL, nameOf, scenariosFor,
  solveWater, USE_LABEL, type CityWorld, type Failure,
} from "./model";
import { narrate, type Story } from "./narrate";
import { streetGraph } from "./model";
import CityScene, { pinTitle, SEVERITY_COLOR, type HubView, type Layers, type LayerId, type Selection, type View } from "./scene/CityScene";

const LAYER_LIST: { id: LayerId; label: string }[] = [
  { id: "buildings", label: "Buildings" },
  { id: "water", label: "Water" },
  { id: "network", label: "Hubs & link" },
  { id: "alerts", label: "Alerts" },
  { id: "sensors", label: "Sensors" },
];

export default function CityApp() {
  const net = useUndercurrent();
  const [world, setWorld] = useState<CityWorld>(() => createWorld());
  const [active, setActive] = useState(34);
  const [view, setView] = useState<View>("3d");
  const [layers, setLayers] = useState<Layers>({ buildings: true, water: true, network: true, alerts: true, sensors: false });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [focus, setFocus] = useState<{ x: number; z: number; key: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sim, setSim] = useState<{ label: string; failure: Failure } | null>(null);
  const [follow, setFollow] = useState(true);

  const water = useMemo(() => solveWater(world, sim?.failure ?? {}), [world, sim]);
  const demo = net.mode === "demo";
  const events = useMemo(() => adaptEvents(net.events, world, { isVerified: net.isVerified, demo }), [net.events, net.isVerified, world, demo]);
  const fresh = useMemo(() => new Set(events.filter((e) => net.isFresh(e.id)).map((e) => e.id)), [events, net]);

  // Hubs on the map, with a short-lived "forgery refused" note when the counter rises.
  const [forgery, setForgery] = useState<{ hubId: string | null; reason: string } | null>(null);
  const lastCount = useRef(0);
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    // Counts that arrive in the first few seconds are history (first polls), not new refusals.
    if (Date.now() - openedAt < 5000 || net.mode !== "live" && net.mode !== "demo") { lastCount.current = net.forgeriesBlocked; return; }
    if (net.forgeriesBlocked > lastCount.current) {
      const r = net.rejected[0] as { hubId?: string; reason?: string } | undefined;
      setForgery({ hubId: r?.hubId ?? null, reason: r?.reason ?? "refused" });
      const t = setTimeout(() => setForgery(null), 7000);
      lastCount.current = net.forgeriesBlocked;
      return () => clearTimeout(t);
    }
    lastCount.current = net.forgeriesBlocked;
  }, [net.forgeriesBlocked, net.rejected, net.mode, openedAt]);
  const hubs: HubView[] = useMemo(() => world.hubs.map((site) => {
    const h = net.hubs.find((x) => x.hubId === site.hubId);
    return {
      ...site, online: !!h?.online, cut: !!h?.link?.cut, queued: h?.link?.queued ?? 0,
      forgery: forgery && (forgery.hubId === site.hubId || (!forgery.hubId && site.level === 34)) ? forgery.reason : null,
    };
  }), [world, net.hubs, forgery]);
  const packetKey = useMemo(() => events.filter((e) => fresh.has(e.id) && e.event.hub_id === "hub-L34").length, [events, fresh]);

  // Follow alerts: jump to new SOS / hazards as they arrive.
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    const latest = events.find((e) => fresh.has(e.id));
    if (!latest || latest.id === lastSeen.current) return;
    lastSeen.current = latest.id;
    if (!follow || SEVERITY_RANK[latest.severity] < SEVERITY_RANK.hazard || !latest.onMap || latest.level === null) return;
    setActive(latest.level);
    setSelection({ type: "event", id: latest.id });
    if (latest.place.kind === "exact") setFocus({ x: latest.place.x, z: latest.place.z, key: Date.now() });
  }, [events, fresh, follow]);

  const goLevel = (n: number) => {
    setActive(n);
    setSelection(null);
    setFocus(null);
  };
  const select = (s: Selection | null) => {
    setSelection(s);
    if (!s) return;
    const at = positionOf(world, s, events);
    if (at && at.level !== active) setActive(at.level);
  };
  const focusOn = (s: Selection) => {
    const at = positionOf(world, s, events);
    if (at?.x !== undefined) setFocus({ x: at.x, z: at.z!, key: Date.now() });
  };

  const level = levelOf(world, active) ?? world.levels[0];
  const sums = useMemo(() => new Map(world.levels.map((l) => [l.n, summarize(events, l.n)])), [world, events]);

  // Flooding: only where a Canary box with a known mount reported water (last 24 h).
  const [spread, setSpread] = useState(false);
  const floodEvent = useMemo(() => events.find((e) =>
    e.level === level.n && e.place.kind === "exact" && e.event.type === "hazard" &&
    (e.event.payload as { kind?: string })?.kind === "flooding" && Date.now() - e.time < 24 * 3600e3), [events, level.n]);
  const flood = useMemo(() => {
    if (!floodEvent || floodEvent.place.kind !== "exact" || !layers.alerts) return null;
    const at: [number, number] = [floodEvent.place.x, floodEvent.place.z];
    const radius = spread ? 45 : 16;
    return { at, radius, blocked: floodedEdges(world.grid, at, radius), spread };
  }, [floodEvent, world.grid, spread, layers.alerts]);
  const cut = useMemo(() => (flood ? cutOffBuildings(world.grid, level, flood.blocked) : new Set<string>()), [flood, world.grid, level]);
  const route = useMemo(() => {
    if (!flood) return null;
    const care = destinations(level, ["hospital", "clinic"]);
    return safeRoute(world.grid, flood.at, care.length ? care : destinations(level, ["shelter"]), flood.blocked);
  }, [flood, level, world.grid]);

  const story: Story = useMemo(() => {
    const streetNames = flood ? [...new Set(streetNamesFor(world, [...flood.blocked]))] : [];
    const dry = [...water.dry.keys()].map((id) => buildingById(world, id)!).filter(Boolean);
    const hub = hubs.find((h) => h.level === level.n), other = hubs.find((h) => h.level !== level.n);
    const counts = world.levels.filter((l) => l.n !== level.n).map((l) => ({ level: l.n, count: sums.get(l.n)?.total ?? 0 })).sort((a, b) => b.count - a.count)[0];
    return narrate({
      level: level.n, levelName: level.name, buildings: level.buildings.filter((b) => b.use !== "pumphouse").length,
      flood: flood && floodEvent ? {
        where: nameOf(world, world.sensors.find((x) => x.deviceId === (floodEvent.place as { deviceId: string }).deviceId)?.building ?? "") || "the sensor",
        ago: timeAgo(floodEvent.event.created_at), verified: floodEvent.verified, demo: floodEvent.demo,
        blockedStreets: streetNames, cutOff: [...cut].filter((id) => !id.endsWith("/pump")).length, spread,
        route: route ? { to: route.to, minutes: route.minutes, via: route.via } : null,
      } : null,
      sim: sim && (sim.failure.nodes?.length || sim.failure.pipes?.length) ? {
        label: sim.label, dry: dry.length, people: dry.reduce((t, b) => t + b.residents, 0),
        levels: [...new Set(dry.map((b) => b.level))].sort((a, b) => a - b),
        facilities: dry.filter((b) => FACILITY_USES.includes(b.use) && b.use !== "pumphouse").map((b) => b.name),
      } : null,
      link: hub && other ? { other: other.level, cut: hub.cut, queued: hub.queued, online: hub.online } : null,
      forgery: hubs.find((h) => h.forgery)?.forgery ?? null,
      sosHere: events.filter((e) => e.level === level.n && e.severity === "sos").length,
      reportsHere: sums.get(level.n)?.total ?? 0,
      reportsElsewhere: counts && counts.count > 0 ? counts : null,
      demo,
    });
  }, [world, level, flood, floodEvent, cut, route, spread, sim, water, hubs, events, sums, demo]);

  return (
    <div className="theme-paper relative h-[100dvh] w-full overflow-hidden">
      <div className="absolute inset-x-0 top-0 bottom-[40dvh] md:bottom-0">
        <CityScene
          world={world} active={level.n} view={view} layers={layers} water={water} selection={selection}
          onSelect={select} onLevel={goLevel} events={events} fresh={fresh} hubs={hubs} packetKey={packetKey}
          focus={focus} resetKey={resetKey} flood={flood} route={route} cut={cut}
        />
      </div>

      <TopBar
        net={net} world={world} active={level.n} sums={sums} view={view} setView={setView} follow={follow} setFollow={setFollow}
        onLevel={goLevel} onReset={() => { setFocus(null); setSelection(null); setResetKey((k) => k + 1); }}
        onAdd={(n) => { setWorld((w) => addLevel(w, n)); goLevel(n); }}
      />

      {demo && (
        <div className="absolute left-1/2 top-[60px] z-40 -translate-x-1/2 rounded-full border border-[var(--warn)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--warn)] shadow-sm">
          Demo data: no hub reachable. Pass <code>?hub=</code> to go live.
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-[64px] z-40 hidden w-[300px] flex-col gap-2 md:flex">
        <LevelCard world={world} level={level.n} events={events} water={water} hubs={hubs} sim={sim} onEvent={(id) => select({ type: "event", id })} />
        <Legend />
      </div>

      <aside className="absolute inset-x-0 bottom-0 z-40 flex h-[40dvh] flex-col gap-2 overflow-y-auto border-t border-[var(--border)] bg-[var(--background)] p-2 md:h-auto md:border-0 md:bg-transparent md:inset-x-auto md:bottom-auto md:right-3 md:top-[64px] md:max-h-[calc(100dvh-80px)] md:w-[330px] md:p-0">
        <div className="md:hidden"><Bubble story={story} flood={!!flood} spread={spread} setSpread={setSpread} /></div>
        {selection ? (
          <Inspector
            world={world} selection={selection} events={events} water={water} net={net} hubs={hubs}
            onClose={() => setSelection(null)} onFocus={() => focusOn(selection)}
            onSim={(label, failure) => setSim({ label, failure })} sim={sim}
          />
        ) : null}
        <div className="order-last md:order-none"><WhatIf world={world} level={level.n} sim={sim} setSim={setSim} water={water} /></div>
        <Feed events={events} fresh={fresh} demo={demo} onPick={(e) => { select({ type: "event", id: e.id }); if (e.place.kind === "exact") setFocus({ x: e.place.x, z: e.place.z, key: Date.now() }); }} onDemoAlert={() => net.actions.demoSensorAlert(34)} />
      </aside>

      <div className="absolute bottom-14 left-3 z-40 hidden w-[380px] md:block">
        <Bubble story={story} flood={!!flood} spread={spread} setSpread={setSpread} />
      </div>

      <div className="absolute bottom-3 left-3 z-40 hidden flex-wrap gap-1.5 md:flex">
        {LAYER_LIST.map((l) => (
          <button
            key={l.id}
            onClick={() => setLayers((s) => ({ ...s, [l.id]: !s[l.id] }))}
            className={`rounded-full border px-3 py-1 text-xs shadow-sm transition ${layers[l.id] ? "border-[var(--border-strong)] bg-[var(--panel)] text-[var(--foreground)]" : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--faint)] line-through"}`}
            aria-pressed={layers[l.id]}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where a selection lives, so the map can switch level and frame it. */
function positionOf(world: CityWorld, s: Selection, events: MapEvent[]): { level: number; x?: number; z?: number } | null {
  switch (s.type) {
    case "building": { const b = buildingById(world, s.id); return b ? { level: b.level, x: b.center[0], z: b.center[1] } : null; }
    case "node": { const n = world.network.node.get(s.id); return n ? { level: n.level, x: n.x, z: n.z } : null; }
    case "pipe": {
      const p = world.network.pipe.get(s.id);
      if (!p) return null;
      const a = world.network.node.get(p.from)!, b = world.network.node.get(p.to)!;
      return { level: p.level, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    }
    case "hub": { const h = world.hubs.find((x) => x.hubId === s.id); return h ? { level: h.level, x: h.x, z: h.z } : null; }
    case "event": {
      const e = events.find((x) => x.id === s.id);
      if (!e || e.level === null || !e.onMap) return null;
      return e.place.kind === "exact" ? { level: e.level, x: e.place.x, z: e.place.z } : { level: e.level };
    }
  }
}

// --- Top bar --------------------------------------------------------------------------------

function TopBar(p: {
  net: Undercurrent; world: CityWorld; active: number; sums: Map<number, ReturnType<typeof summarize>>; view: View; setView: (v: View) => void;
  follow: boolean; setFollow: (b: boolean) => void; onLevel: (n: number) => void; onReset: () => void; onAdd: (n: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <header className="absolute inset-x-0 top-0 z-50 flex h-[52px] items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)]/95 px-3 backdrop-blur">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[15px] font-semibold tracking-tight">The Hollow</span>
        <span className={`hidden rounded-full px-2 py-0.5 text-[11px] sm:inline ${p.net.mode === "live" ? "bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-[var(--ok)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>
          {p.net.mode === "live" ? "● Live" : p.net.mode === "demo" ? "Demo data" : "Connecting…"}
        </span>
      </div>

      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Levels">
        {p.world.levels.map((l) => {
          const s = p.sums.get(l.n);
          const on = l.n === p.active;
          return (
            <button
              key={l.n}
              onClick={() => p.onLevel(l.n)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition ${on ? "bg-[var(--foreground)] text-[var(--panel)]" : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--foreground)]"}`}
              aria-current={on ? "true" : undefined}
            >
              <span className="font-medium">L{l.n}</span>
              <span className="hidden lg:inline">{l.name}</span>
              {s?.worst && <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s.worst] }} title={`${s.total} event${s.total === 1 ? "" : "s"}`} />}
            </button>
          );
        })}
        <div className="relative shrink-0">
          <button onClick={() => setAdding((a) => !a)} className="rounded-md border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            + Add level
          </button>
          {adding && <AddLevel world={p.world} onAdd={(n) => { p.onAdd(n); setAdding(false); }} onClose={() => setAdding(false)} />}
        </div>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="flex rounded-md border border-[var(--border)] p-0.5 text-xs">
          {(["3d", "top"] as View[]).map((v) => (
            <button key={v} onClick={() => p.setView(v)} className={`rounded px-2 py-1 ${p.view === v ? "bg-[var(--panel-2)] font-medium text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
              {v === "3d" ? "3D" : "Top"}
            </button>
          ))}
        </div>
        <button onClick={p.onReset} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Reset view</button>
        <label className="hidden items-center gap-1.5 text-xs text-[var(--muted)] lg:flex">
          <input type="checkbox" checked={p.follow} onChange={(e) => p.setFollow(e.target.checked)} /> Follow alerts
        </label>
        <Link href="/dashboard" className="hidden text-xs text-[var(--muted)] underline-offset-2 hover:underline sm:inline">Console</Link>
        <Link href="/truth" className="hidden text-xs text-[var(--muted)] underline-offset-2 hover:underline sm:inline">Directorate view</Link>
      </div>
    </header>
  );
}

function AddLevel({ world, onAdd, onClose }: { world: CityWorld; onAdd: (n: number) => void; onClose: () => void }) {
  const have = new Set(world.levels.map((l) => l.n));
  const suggest = [...Array(MAX_LEVEL)].map((_, i) => i + 1).find((n) => !have.has(n) && n > Math.max(...have)) ?? 1;
  const [val, setVal] = useState(String(suggest));
  const n = Number(val);
  const error = !Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL ? `Pick a level from ${MIN_LEVEL} to ${MAX_LEVEL}` : have.has(n) ? `L${n} is already on the map` : null;
  return (
    <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-lg">
      <form onSubmit={(e) => { e.preventDefault(); if (!error) onAdd(n); }} className="flex items-center gap-2">
        <label className="text-sm">Level</label>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} inputMode="numeric" className="w-16 rounded border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 text-sm" />
        <button disabled={!!error} className="rounded bg-[var(--foreground)] px-2.5 py-1 text-sm text-[var(--panel)] disabled:opacity-40">Add</button>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-[var(--muted)]">Close</button>
      </form>
      <p className={`mt-2 text-xs ${error ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {error ?? "Generates its streets, buildings and pipes from the seed and joins it to the riser. Levels already on the map don't change."}
      </p>
    </div>
  );
}

// --- Left: what's happening on this level ------------------------------------------------------

function levelFacts(world: CityWorld, n: number, events: MapEvent[], water: ReturnType<typeof solveWater>) {
  const l = levelOf(world, n)!;
  const here = events.filter((e) => e.level === n);
  const dry = l.buildings.filter((b) => water.dry.has(b.id));
  return { l, here, dry, served: l.buildings.filter((b) => b.use !== "pumphouse").length };
}

function LevelCard({ world, level, events, water, hubs, sim, onEvent }: {
  world: CityWorld; level: number; events: MapEvent[]; water: ReturnType<typeof solveWater>; hubs: HubView[];
  sim: { label: string } | null; onEvent: (id: string) => void;
}) {
  const { l, here, dry, served } = levelFacts(world, level, events, water);
  const pinned = here.filter((e) => e.place.kind === "exact");
  const loose = here.filter((e) => e.place.kind === "level");
  const hub = hubs.find((h) => h.level === level);
  const other = hubs.find((h) => h.level !== level);
  return (
    <section className="pointer-events-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 shadow-sm">
      <p className="text-xs text-[var(--muted)]">Level {level}</p>
      <h1 className="text-lg font-semibold leading-tight">{l.name}</h1>
      <ul className="mt-2.5 space-y-1.5 text-sm">
        <Fact color={dry.length ? "var(--warn)" : "var(--ok)"}>
          {dry.length ? <>{dry.length} of {served} buildings without water <SimTag /></> : <>Water reaching all {served} buildings</>}
        </Fact>
        <Fact color={here.length ? SEVERITY_COLOR[summarize(events, level).worst ?? "info"] : "var(--ok)"}>
          {here.length ? <>{here.length} report{here.length === 1 ? "" : "s"} from this level{pinned.length ? `, ${pinned.length} pinned to a sensor` : ""}</> : "No reports from this level"}
        </Fact>
        {hub && other && (
          <Fact color={!hub.online ? "var(--faint)" : hub.cut ? "var(--danger)" : "var(--ok)"}>
            {!hub.online ? `Hub ${level} offline` : hub.cut ? `Link to L${other.level} cut${hub.queued ? ` · ${hub.queued} waiting to send` : ""}` : `Hub linked to L${other.level}`}
          </Fact>
        )}
      </ul>
      {sim && dry.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">Because: {sim.label} (simulated).</p>}
      {loose.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <p className="text-xs text-[var(--muted)]">On this level, exact spot not reported</p>
          <ul className="mt-1.5 space-y-1">
            {loose.slice(0, 5).map((e) => (
              <li key={e.id}>
                <button onClick={() => onEvent(e.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-[var(--panel-2)]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[e.severity] }} />
                  <span className="truncate">{pinTitle(e)}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-[var(--faint)]">{e.verified ? "verified" : "unverified"}</span>
                </button>
              </li>
            ))}
            {loose.length > 5 && <li className="px-1 text-xs text-[var(--faint)]">+{loose.length - 5} more in the feed</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function MobileStatus({ world, level, events, water }: { world: CityWorld; level: number; events: MapEvent[]; water: ReturnType<typeof solveWater> }) {
  const { l, here, dry } = levelFacts(world, level, events, water);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm shadow-sm md:hidden">
      <span className="font-semibold">L{level} · {l.name}</span>
      <span className="text-[var(--muted)]"> · {here.length} report{here.length === 1 ? "" : "s"} · {dry.length ? `${dry.length} without water (sim)` : "water normal"}</span>
    </div>
  );
}

function Fact({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span>{children}</span>
    </li>
  );
}

const SimTag = () => <span className="ml-1 rounded bg-[color-mix(in_oklab,var(--sim)_14%,transparent)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[var(--sim)]">Simulated</span>;

function Legend() {
  return (
    <details className="pointer-events-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-xs shadow-sm">
      <summary className="cursor-pointer text-[var(--muted)]">How to read this map</summary>
      <ul className="mt-2 space-y-1.5">
        <Swatch c="#6a7483">Homes and workshops (grey roofs)</Swatch>
        <Swatch c="#9a5f55">Clinics and hospitals</Swatch>
        <Swatch c="#5f7d6b">Shelters</Swatch>
        <Swatch c="#3b82c4">Pipe carrying water; arrows show which way it flows</Swatch>
        <Swatch c="#c98f2e">Building cut off from water (simulated)</Swatch>
        <Swatch c="#c2412d" round>Pin: a sensor alert at a known spot. Faded = not verified.</Swatch>
      </ul>
      <p className="mt-2 text-[var(--muted)]">
        Streets, buildings and pipes are <b>generated</b>. Hubs, the link and alerts are <b>live</b> from the hubs.
        Reports only say which level they came from, so they're listed, not pinned. Drag to pan, right-drag to rotate, scroll to zoom.
      </p>
    </details>
  );
}
const Swatch = ({ c, round, children }: { c: string; round?: boolean; children: React.ReactNode }) => (
  <li className="flex items-center gap-2"><span className={`size-3 shrink-0 ${round ? "rounded-full" : "rounded-sm"}`} style={{ background: c }} />{children}</li>
);

// --- Right: inspector, what-if, feed ------------------------------------------------------------

function Card({ title, children, right }: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 shadow-sm">
      <div className="mb-2 flex items-start gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
      {children}
    </section>
  );
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-0.5 text-sm"><span className="text-[var(--muted)]">{k}</span><span className="text-right">{v}</span></div>
);
const Btn = ({ onClick, children, tone }: { onClick: () => void; children: React.ReactNode; tone?: "danger" }) => (
  <button onClick={onClick} className={`mt-2 w-full rounded-md border px-3 py-1.5 text-sm transition hover:bg-[var(--panel-2)] ${tone === "danger" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--border-strong)]"}`}>{children}</button>
);

function Inspector({ world, selection, events, water, net, hubs, onClose, onFocus, onSim, sim }: {
  world: CityWorld; selection: Selection; events: MapEvent[]; water: ReturnType<typeof solveWater>; net: Undercurrent; hubs: HubView[];
  onClose: () => void; onFocus: () => void; onSim: (label: string, f: Failure) => void; sim: { label: string; failure: Failure } | null;
}) {
  const close = (
    <>
      <button onClick={onFocus} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Zoom to</button>
      <button onClick={onClose} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]" aria-label="Close">✕</button>
    </>
  );
  const cause = (id: string) => nameOf(world, id);

  if (selection.type === "building") {
    const b = buildingById(world, selection.id);
    if (!b) return null;
    const tap = world.network.tapOf.get(b.id);
    const dry = water.dry.get(b.id);
    return (
      <Card title={b.use === "housing" || b.use === "workshop" ? USE_LABEL[b.use] : b.name} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">L{b.level} · generated building</p>
        <Row k="Water" v={dry ? <span className="text-[var(--warn)]">None: {cause(dry)} <SimTag /></span> : <span className="text-[var(--ok)]">Supplied</span>} />
        {b.residents > 0 && <Row k="People (estimate)" v={b.residents} />}
        <Row k="Height" v={`${b.height} m`} />
        {tap && <Row k="Fed by" v={nameOf(world, tap.pipe)} />}
        {tap && !dry && <Btn onClick={() => onSim(`${nameOf(world, tap.pipe)} breaks`, { pipes: [tap.pipe] })}>What if its main breaks?</Btn>}
      </Card>
    );
  }
  if (selection.type === "pipe" || selection.type === "node") {
    const id = selection.id;
    const pipe = world.network.pipe.get(id), node = world.network.node.get(id);
    const label = pipe?.label ?? node?.label ?? id;
    const failed = water.failed.has(id);
    const ok = pipe ? water.flowing.has(id) : water.supplied.has(id);
    const downstream = failed ? [...water.dry.values()].filter((c) => c === id).length : 0;
    const isOnlyFailure = sim && [...(sim.failure.nodes ?? []), ...(sim.failure.pipes ?? [])].length === 1 && failed;
    return (
      <Card title={label} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">L{(pipe ?? node)!.level} · generated water network</p>
        <Row k="State" v={failed ? <span className="text-[var(--danger)]">Failed <SimTag /></span> : ok ? <span className="text-[var(--ok)]">{pipe ? "Water flowing" : "Running"}</span> : <span className="text-[var(--warn)]">No water reaching it</span>} />
        {failed && <Row k="Buildings cut off" v={downstream} />}
        {node?.kind === "pump" && <Row k="Lifts water from" v="the riser to this level's mains" />}
        {node?.kind === "source" && <Row k="Feeds" v="the riser for every level" />}
        {isOnlyFailure
          ? <Btn onClick={() => onSim("", {})}>Repair (end simulation)</Btn>
          : !failed && <Btn tone="danger" onClick={() => onSim(`${label} ${pipe ? "breaks" : "stops"}`, pipe ? { pipes: [id] } : { nodes: [id] })}>Simulate a {pipe ? "break" : "failure"} here</Btn>}
      </Card>
    );
  }
  if (selection.type === "hub") {
    const view = hubs.find((h) => h.hubId === selection.id);
    const state = net.hubs.find((h) => h.hubId === selection.id);
    if (!view) return null;
    return (
      <Card title={`Hub ${view.hubId.replace("hub-", "")}`} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">Live · relay on level {view.level}</p>
        <Row k="Status" v={view.online ? "Online" : "Offline"} />
        <Row k="Link" v={view.cut ? <span className="text-[var(--danger)]">Cut</span> : <span className="text-[var(--ok)]">Up</span>} />
        {view.cut && <Row k="Waiting to send" v={view.queued} />}
        {state?.link && <Btn onClick={() => net.actions.setLink(state, { cut: !state.link!.cut })}>{state.link.cut ? "Restore the link" : "Cut the link"}</Btn>}
        <p className="mt-2 text-xs text-[var(--muted)]">The console shows the counters and checks that prove what happened.</p>
      </Card>
    );
  }
  // event
  const e = events.find((x) => x.id === selection.id);
  if (!e) return <Card title="Report" right={close}><p className="text-sm text-[var(--muted)]">No longer in the feed.</p></Card>;
  const tampered = net.chain?.first_bad_event === e.id;
  const where = e.place.kind === "exact"
    ? `At ${e.place.deviceId} (its mount is known)`
    : e.place.kind === "level" ? `Somewhere on L${e.level}; the report doesn't say where${e.onMap ? "" : " (level not on the map yet)"}` : "Unknown: no level given";
  return (
    <Card title={<><span style={{ color: SEVERITY_COLOR[e.severity] }}>●</span> {pinTitle(e)}</>} right={close}>
      <p className="mb-2 text-xs text-[var(--muted)]">{SEVERITY_LABEL[e.severity]} · {timeAgo(e.event.created_at)}{e.demo ? " · demo data" : ""}</p>
      {e.severity !== "message" && <p className="mb-2 text-sm">{summary(e.event)}</p>}
      {e.severity === "message" && <p className="mb-2 text-sm text-[var(--muted)]">Encrypted cell message. Only members with the key can read it.</p>}
      <Row k="Check" v={tampered ? <span className="text-[var(--danger)]">Record edited after the fact</span> : e.verified ? <span className="text-[var(--ok)]">Verified by hub</span> : <span className="text-[var(--warn)]">Not verified</span>} />
      <Row k="From" v={e.origin === "sensor" ? `Canary box ${e.event.device_id ?? ""}` : "A resident"} />
      <Row k="Where" v={where} />
      <Row k="Via" v={e.event.hub_id} />
    </Card>
  );
}

function WhatIf({ world, level, sim, setSim, water }: {
  world: CityWorld; level: number; sim: { label: string; failure: Failure } | null; setSim: (s: { label: string; failure: Failure } | null) => void; water: ReturnType<typeof solveWater>;
}) {
  const list = scenariosFor(world, level);
  const dry = [...water.dry.keys()].map((id) => buildingById(world, id)!).filter(Boolean);
  const people = dry.reduce((s, b) => s + b.residents, 0);
  const levels = [...new Set(dry.map((b) => b.level))].sort((a, b) => a - b);
  const facilities = dry.filter((b) => FACILITY_USES.includes(b.use) && b.use !== "pumphouse");
  const active = sim && (sim.failure.nodes?.length || sim.failure.pipes?.length);
  return (
    <Card title="What if…" right={<SimTag />}>
      {!active && (
        <div className="flex flex-col gap-1.5">
          {list.map((s) => (
            <button key={s.id} onClick={() => setSim({ label: s.label, failure: s.failure })} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-left text-sm hover:bg-[var(--panel-2)]">
              {s.label}
            </button>
          ))}
          <p className="text-xs text-[var(--muted)]">Or click any pipe or lift station on the map. Uses the generated network, not real readings.</p>
        </div>
      )}
      {active && (
        <div className="sim-hatch -m-1 rounded-lg p-1">
          <p className="text-sm font-medium">{sim!.label}</p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            <li><b>{dry.length}</b> buildings lose water{levels.length ? ` on ${levels.map((n) => `L${n}`).join(", ")}` : ""}</li>
            <li>About <b>{people.toLocaleString()}</b> people (generated estimate)</li>
            {facilities.length > 0 && <li className="text-[var(--danger)]">Hit: {facilities.map((b) => b.name).join(", ")}</li>}
          </ul>
          <button onClick={() => setSim(null)} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 text-sm hover:bg-[var(--panel-2)]">Clear simulation</button>
        </div>
      )}
    </Card>
  );
}

function Feed({ events, fresh, demo, onPick, onDemoAlert }: { events: MapEvent[]; fresh: ReadonlySet<string>; demo: boolean; onPick: (e: MapEvent) => void; onDemoAlert: () => void }) {
  return (
    <Card title="Latest from the hubs" right={demo ? <button onClick={onDemoAlert} className="text-xs text-[var(--muted)] underline">+ demo sensor alert</button> : <span className="text-xs text-[var(--faint)]">{events.length}</span>}>
      {events.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing yet. New reports appear here as the hubs receive them.</p>}
      <ul className="-mx-1 max-h-[34vh] space-y-0.5 overflow-y-auto">
        {events.slice(0, 40).map((e) => (
          <li key={e.id}>
            <button onClick={() => onPick(e)} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[var(--panel-2)] ${fresh.has(e.id) ? "bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]" : ""}`}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[e.severity], opacity: e.verified ? 1 : 0.45 }} />
              <span className="w-9 shrink-0 text-xs text-[var(--muted)]">{e.level !== null ? `L${e.level}` : "L?"}</span>
              <span className="truncate">{pinTitle(e)}</span>
              <span className="ml-auto shrink-0 text-[11px] text-[var(--faint)]">{e.verified ? "✓" : "unverified"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function streetNamesFor(world: CityWorld, edgeIds: string[]): string[] {
  const g = streetGraph(world.grid);
  return edgeIds.map((id) => g.edges.find((e) => e.id === id)?.street).filter((x): x is string => !!x);
}

// --- The "What's happening" bubble -------------------------------------------------------------

const TONE: Record<Story["tone"], { bar: string; label: string }> = {
  calm: { bar: "var(--ok)", label: "All clear" },
  caution: { bar: "var(--warn)", label: "Heads up" },
  alert: { bar: "var(--danger)", label: "Alert" },
  sim: { bar: "var(--sim)", label: "Simulation" },
};

function Bubble({ story, flood, spread, setSpread }: { story: Story; flood: boolean; spread: boolean; setSpread: (b: boolean) => void }) {
  const t = TONE[story.tone];
  return (
    <section
      key={story.title}
      role="status"
      aria-live="polite"
      className="bubble-in relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-3 pl-4 pr-3.5 shadow-[0_6px_24px_rgb(0_0_0/0.08)]"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.bar }} />
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: t.bar }}>
        <span className="size-1.5 rounded-full" style={{ background: t.bar }} /> What&apos;s happening · {t.label}
      </p>
      <h2 className="mt-1 text-[15px] font-semibold leading-snug">{story.title}</h2>
      {story.lines.map((l) => <p key={l} className="mt-1 text-[13px] leading-snug text-[var(--muted)]">{l}</p>)}
      <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">{story.source}</p>
      <div className="flex">
        {flood && (
          <button onClick={() => setSpread(!spread)} className="mt-2 rounded-full border border-[var(--border-strong)] px-2.5 py-0.5 text-[11px] hover:bg-[var(--panel-2)]">
            {spread ? "Back to the reading" : "What if it keeps rising?"}
          </button>
        )}
      </div>
    </section>
  );
}
