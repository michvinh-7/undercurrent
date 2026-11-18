"use client";

// The Hollow: a generated 40-level city joined to the live Undercurrent network.
//   GENERATED  the city, its buildings and water network (world/generate.ts, fixed seed)
//   SIMULATED  what a failure would do to that network (sim/water.ts), always labeled
//   LIVE       events, the link and refused forgeries, from the hubs (lib/useUndercurrent.ts)
// The console stays the proof; this map shows where things happen.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { summary, timeAgo, TYPE_LABEL } from "@/lib/format";
import type { HollowEvent } from "@/lib/types";
import { isEncrypted, isSensor, useUndercurrent } from "@/lib/useUndercurrent";
import Scene, { type HubView } from "./scene/Scene";
import {
  DEFAULT_LAYERS, LAYERS, SEVERITY_COLOR, SEVERITY_RANK, locate, severityOf,
  type LayerId, type LayerMode, type Layers, type Selection, type Severity,
} from "./scene/shared";
import { SCENARIOS, solveWater, traceDownstream, type Failure } from "./sim/water";
import { generateWorld, isInfrastructure } from "./world/generate";
import { validateWorld } from "./world/validate";
import type { World } from "./world/types";

const pad = (n: number) => String(n).padStart(2, "0");

export default function HollowApp() {
  const world = useMemo(() => generateWorld(), []);
  const checks = useMemo(() => validateWorld(world), [world]);
  const net = useUndercurrent();

  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [focus, setFocus] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [directorate, setDirectorate] = useState(false);
  const [follow, setFollow] = useState(true);

  // --- Simulation (labeled SIMULATED everywhere) ---
  const [sim, setSim] = useState<{ title: string; failure?: Failure; contaminate?: string } | null>(null);
  const water = useMemo(() => solveWater(world, sim?.failure), [world, sim]);
  const hops = useMemo(() => (sim?.contaminate ? traceDownstream(world, sim.contaminate, water) : null), [world, sim, water]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!hops) return;
    setStep(0);
    const max = Math.max(...hops.values());
    const t = setInterval(() => setStep((s) => (s >= max ? (clearInterval(t), s) : s + 1)), 260);
    return () => clearInterval(t);
  }, [hops]);
  const tracer = useMemo(() => (hops ? { hops, step } : null), [hops, step]);

  // --- Live network → the map ---
  const events = useMemo(() => net.events.filter((e) => e.type !== "roster"), [net.events]);
  const located = useMemo(() => events.filter((e) => e.level >= 1 && e.level <= 40).map((e) => locate(e, world)), [events, world]);
  const levelSeverity = useMemo(() => {
    const m = new Map<number, Severity>();
    for (const l of located) {
      const s = severityOf(l.event);
      const cur = m.get(l.level);
      if (!cur || SEVERITY_RANK[s] > SEVERITY_RANK[cur]) m.set(l.level, s);
    }
    return m;
  }, [located]);
  const hubs: HubView[] = useMemo(
    () =>
      world.hubs.map((site) => {
        const h = net.hubs.find((x) => x.hubId === site.hubId);
        return { hubId: site.hubId, level: site.level, online: !!h?.online, cut: !!h?.link?.cut, queued: h?.link?.queued ?? 0 };
      }),
    [world, net.hubs],
  );

  // New events after the backlog: packets on the link, and (optionally) jump to urgent ones.
  const fresh = useMemo(
    () => events.filter((e) => net.isFresh(e.id)).sort((a, b) => (net.arrived.get(a.id) ?? 0) - (net.arrived.get(b.id) ?? 0)),
    [events, net],
  );
  const packetKey = fresh.filter((e) => e.hub_id === "hub-L34").length;
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    const latest = fresh[fresh.length - 1];
    if (!latest || latest.id === lastSeen.current) return;
    lastSeen.current = latest.id;
    const s = severityOf(latest);
    if (follow && (s === "sos" || s === "hazard")) {
      setFocus(latest.level);
      setSelection({ type: "event", id: latest.id });
    }
  }, [fresh, follow]);

  const focusLevel = (n: number | null) => {
    setFocus(n);
    setSelection(n === null ? null : { type: "level", n });
  };

  const props = {
    world, checks, net, layers, setLayers, focus, focusLevel, setFocus, selection, setSelection, water, tracer, sim, setSim,
    levelSeverity, events, directorate, located,
  };

  return (
    <main className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:overflow-hidden" style={directorate ? { boxShadow: "inset 0 0 0 2px var(--directorate)" } : undefined}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <div>
          <p className="caption">Undercurrent / The Hollow / network map</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
            {directorate ? "The Hollow, through Directorate eyes" : "Forty levels. One shared signal."}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <WorldCheck checks={checks} world={world} />
          <ModeDot mode={net.mode} />
          <label className="flex cursor-pointer items-center gap-1.5 text-[var(--muted)]">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--accent)]" />
            Follow alerts
          </label>
          <button
            role="switch"
            aria-checked={directorate}
            onClick={() => setDirectorate(!directorate)}
            className="rounded-full border px-3 py-1"
            style={{ borderColor: directorate ? "var(--directorate)" : "var(--border-strong)", color: directorate ? "var(--directorate)" : undefined }}
          >
            Directorate view
          </button>
          <Link href="/dashboard" className="text-[var(--muted)] hover:text-[var(--foreground)]">Console →</Link>
        </div>
      </header>

      {net.mode === "demo" && (
        <p className="sim-hatch border-b border-[var(--sim)] px-4 py-1.5 text-xs sm:px-6">
          <span className="caption mr-2 !text-[var(--sim)]">Demo data</span>No hub answered. Live layers show example events.
        </p>
      )}

      <div className="relative flex-1">
        <div className="relative h-[62vh] lg:absolute lg:inset-0 lg:h-auto">
          <Scene
            world={world}
            layers={layers}
            focus={focus}
            onFocus={setFocus}
            selection={selection}
            onSelect={setSelection}
            water={water}
            tracer={tracer}
            located={located}
            levelSeverity={levelSeverity}
            hubs={hubs}
            forgeries={{ count: net.forgeriesBlocked, reason: net.rejected[0]?.reason ?? null }}
            packetKey={packetKey}
            directorate={directorate}
          />
          <LevelRail {...props} />
          <LayerControls layers={layers} setLayers={setLayers} />
          <p className="caption pointer-events-none absolute bottom-3 right-3 hidden !text-[var(--faint)] lg:right-[372px] lg:block">
            Fig. 01 · generated city, seed {world.config.seed} · not to scale
          </p>
        </div>

        <aside className="relative z-40 space-y-3 p-4 lg:absolute lg:bottom-3 lg:right-3 lg:top-3 lg:w-[350px] lg:overflow-y-auto lg:p-0">
          <MobileLevelPicker {...props} />
          <Inspector {...props} />
          <SimulationPanel {...props} />
          <Feed {...props} />
        </aside>
      </div>
    </main>
  );
}

type P = {
  world: World;
  checks: ReturnType<typeof validateWorld>;
  net: ReturnType<typeof useUndercurrent>;
  layers: Layers;
  setLayers: (l: Layers) => void;
  focus: number | null;
  focusLevel: (n: number | null) => void;
  setFocus: (n: number | null) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  water: ReturnType<typeof solveWater>;
  tracer: { hops: Map<string, number>; step: number } | null;
  sim: { title: string; failure?: Failure; contaminate?: string } | null;
  setSim: (s: P["sim"]) => void;
  levelSeverity: Map<number, Severity>;
  events: HollowEvent[];
  located: ReturnType<typeof locate>[];
  directorate: boolean;
};

// --- Small pieces ---------------------------------------------------------------------

type SourceKind = "live" | "reported" | "generated" | "simulated";
const SOURCE: Record<SourceKind, { label: string; color: string }> = {
  live: { label: "Live · from the hub", color: "var(--ok)" },
  reported: { label: "Reported by a resident", color: "var(--accent)" },
  generated: { label: "Generated world", color: "var(--muted)" },
  simulated: { label: "Simulated", color: "var(--sim)" },
};
function Source({ kind }: { kind: SourceKind }) {
  const s = SOURCE[kind];
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${kind === "simulated" ? "sim-hatch" : ""}`}
      style={{ color: s.color, boxShadow: `inset 0 0 0 1px ${s.color}` }}
    >
      {s.label}
    </span>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="caption">{title}</h2>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-1.5 text-sm last:border-0">
      <span className="text-[var(--muted)]">{k}</span>
      <span className="text-right font-mono text-[13px]" style={{ color }}>{v}</span>
    </div>
  );
}

function ModeDot({ mode }: { mode: string }) {
  const color = mode === "live" ? "var(--ok)" : mode === "demo" ? "var(--sim)" : "var(--warn)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {mode === "live" ? "Live" : mode === "demo" ? "Demo data" : "Reconnecting…"}
    </span>
  );
}

function WorldCheck({ checks, world }: { checks: P["checks"]; world: World }) {
  const [open, setOpen] = useState(false);
  const passed = checks.filter((c) => c.pass).length;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="rounded-full border border-[var(--border-strong)] px-3 py-1 font-mono text-xs">
        World check <span style={{ color: passed === checks.length ? "var(--ok)" : "var(--danger)" }}>{passed}/{checks.length}</span>
      </button>
      {open && (
        <div className="panel absolute right-0 z-[60] mt-2 w-[340px] p-4 shadow-2xl">
          <p className="caption">Generated world · seed {world.config.seed}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {world.levels.length} levels, {world.buildings.length.toLocaleString()} buildings, {world.water.pipes.length.toLocaleString()} pipes,{" "}
            {world.config.population.toLocaleString()} residents. Fictional: not a map of real infrastructure.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span>
                  <span style={{ color: c.pass ? "var(--ok)" : "var(--danger)" }}>{c.pass ? "✓" : "✗"}</span> {c.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Level rail -------------------------------------------------------------------------

function levelSimState(world: World, water: P["water"], tracer: P["tracer"], n: number) {
  const consumers = world.buildings.filter((b) => b.level === n && !isInfrastructure(b.kind));
  const dry = consumers.filter((b) => water.cutOff.has(b.id)).length;
  const dirty = tracer ? consumers.filter((b) => (tracer.hops.get(b.id) ?? Infinity) <= tracer.step).length : 0;
  return { dry, dirty, total: consumers.length };
}

function LevelRail({ world, focus, focusLevel, levelSeverity, water, tracer }: P) {
  return (
    <nav className="panel absolute bottom-24 left-3 top-3 z-40 hidden w-48 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] backdrop-blur lg:flex">
      <button
        onClick={() => focusLevel(null)}
        className="caption border-b border-[var(--border)] px-3 py-2 text-left hover:!text-[var(--foreground)]"
        style={focus === null ? { color: "var(--accent)" } : undefined}
      >
        ↥ All 40 levels
      </button>
      <ol className="flex-1 overflow-y-auto py-1">
        {world.levels.map((l) => {
          const sev = levelSeverity.get(l.n);
          const s = levelSimState(world, water, tracer, l.n);
          const hub = world.hubs.find((h) => h.level === l.n);
          return (
            <li key={l.n}>
              <button
                onClick={() => focusLevel(l.n)}
                className="flex w-full items-center gap-2 px-3 py-[3px] text-left text-xs hover:bg-[var(--panel-2)]"
                style={focus === l.n ? { background: "var(--panel-2)", color: "var(--foreground)" } : { color: "var(--muted)" }}
              >
                <span className="w-6 font-mono">{pad(l.n)}</span>
                <span className="flex-1 truncate">{l.name}</span>
                {hub && <span className="font-mono text-[9px] text-[var(--accent)]">HUB</span>}
                {(s.dry > 0 || s.dirty > 0) && (
                  <span className="sim-hatch h-2 w-2 rounded-sm" style={{ boxShadow: `inset 0 0 0 1px ${s.dirty ? "var(--danger)" : "var(--warn)"}` }} title="Simulated impact" />
                )}
                {sev && <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLOR[sev] }} />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileLevelPicker({ world, focus, focusLevel }: P) {
  return (
    <label className="block lg:hidden">
      <span className="caption">Level</span>
      <select
        value={focus ?? ""}
        onChange={(e) => focusLevel(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-base"
      >
        <option value="">All 40 levels</option>
        {world.levels.map((l) => (
          <option key={l.n} value={l.n}>L{pad(l.n)} · {l.name}</option>
        ))}
      </select>
    </label>
  );
}

// --- Layer switches: off / on / focus -----------------------------------------------------

function LayerControls({ layers, setLayers }: { layers: Layers; setLayers: (l: Layers) => void }) {
  const set = (id: LayerId, mode: LayerMode) => {
    const next = { ...layers };
    if (mode === "focus") for (const k of Object.keys(next) as LayerId[]) if (next[k] === "focus") next[k] = "on";
    next[id] = mode;
    setLayers(next);
  };
  return (
    <div className="panel absolute bottom-3 left-3 right-3 z-40 flex gap-1 overflow-x-auto bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] p-1.5 backdrop-blur lg:right-auto">
      {LAYERS.map((l) => (
        <div key={l.id} className="shrink-0 rounded-lg px-2 py-1" title={l.hint}>
          <p className="caption mb-1">{l.label}</p>
          <div className="flex overflow-hidden rounded-md border border-[var(--border-strong)] text-[11px]">
            {(["off", "on", "focus"] as LayerMode[]).map((m) => (
              <button
                key={m}
                onClick={() => set(l.id, m)}
                className="px-2 py-0.5 capitalize"
                style={
                  layers[l.id] === m
                    ? { background: m === "off" ? "var(--border-strong)" : "var(--accent)", color: "white" }
                    : { color: "var(--muted)" }
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Inspector --------------------------------------------------------------------------

function Inspector(p: P) {
  const { selection, focus } = p;
  const sel: Selection | null = selection ?? (focus !== null ? { type: "level", n: focus } : null);
  if (!sel) return <Overview {...p} />;
  if (sel.type === "level") return <LevelInfo {...p} n={sel.n} />;
  if (sel.type === "building") return <BuildingInfo {...p} id={sel.id} />;
  if (sel.type === "pipe") return <PipeInfo {...p} id={sel.id} />;
  if (sel.type === "node") return <NodeInfo {...p} id={sel.id} />;
  if (sel.type === "hub") return <HubInfo {...p} id={sel.id} />;
  return <EventInfo {...p} id={sel.id} />;
}

function Overview({ world, net, events }: P) {
  const verified = events.filter(net.isVerified).length;
  return (
    <Card title="The Hollow" right={<Source kind="generated" />}>
      <p className="text-sm text-[var(--muted)]">
        A vertical city of {world.levels.length} levels around one shaft. Click a level, a building, a pipe or a hub. Every
        value is labeled by where it comes from.
      </p>
      <div className="mt-3">
        <Row k="Residents" v={world.config.population.toLocaleString()} />
        <Row k="Buildings" v={world.buildings.length.toLocaleString()} />
        <Row k="Live reports" v={`${verified} verified of ${events.length}`} color="var(--ok)" />
        <Row k="Forgeries refused" v={net.forgeriesBlocked} color={net.forgeriesBlocked ? "var(--danger)" : undefined} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Source kind="live" />
        <Source kind="reported" />
        <Source kind="generated" />
        <Source kind="simulated" />
      </div>
    </Card>
  );
}

function LevelInfo({ world, n, events, water, tracer, net, setSelection, directorate }: P & { n: number }) {
  const level = world.levels[n - 1];
  const here = world.buildings.filter((b) => b.level === n);
  const s = levelSimState(world, water, tracer, n);
  const live = events.filter((e) => e.level === n).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const facilities = here.filter((b) => b.kind !== "residential" && b.kind !== "workshop" && b.kind !== "market");
  return (
    <Card title={`Level ${pad(n)}`} right={<Source kind="generated" />}>
      <p className="text-lg font-semibold">{level.name}</p>
      <Row k="District" v={level.district} />
      <Row k="Residents (generated)" v={level.population.toLocaleString()} />
      <Row k="Buildings" v={here.length} />
      {facilities.length > 0 && <Row k="Facilities" v={facilities.map((f) => f.name).join(", ")} />}
      <Row
        k="Water (simulated)"
        v={s.dirty ? `${s.dirty} contaminated` : s.dry ? `${s.dry} of ${s.total} without water` : "all supplied"}
        color={s.dirty ? "var(--danger)" : s.dry ? "var(--warn)" : "var(--water)"}
      />
      <p className="caption mt-4">Live on this level · {live.length}</p>
      <ul className="mt-2 space-y-1.5">
        {live.slice(0, 6).map((e) => (
          <EventLine key={e.id} e={e} verified={net.isVerified(e)} directorate={directorate} onClick={() => setSelection({ type: "event", id: e.id })} />
        ))}
        {live.length === 0 && <li className="text-sm text-[var(--muted)]">Nothing reported here.</li>}
      </ul>
    </Card>
  );
}

function BuildingInfo({ world, id, water, tracer, sim }: P & { id: string }) {
  const b = world.buildings.find((x) => x.id === id);
  if (!b) return null;
  const cause = water.cutOff.get(b.id);
  const dirty = tracer ? (tracer.hops.get(b.id) ?? Infinity) <= tracer.step : false;
  const sensor = world.sensors.find((s) => s.buildingId === b.id);
  return (
    <Card title={b.kind.replace("_", " ")} right={<Source kind="generated" />}>
      <p className="text-lg font-semibold">{b.name}</p>
      <Row k="Level" v={`L${pad(b.level)} · ${world.levels[b.level - 1].name}`} />
      {b.population > 0 && <Row k="Residents (generated)" v={b.population} />}
      {b.capacity > 0 && <Row k="Capacity" v={b.capacity} />}
      {!isInfrastructure(b.kind) && (
        <Row
          k={sim ? "Water (simulated)" : "Water"}
          v={dirty ? "contaminated" : cause ? `cut off by ${cause}` : `supplied via J-${b.level}`}
          color={dirty ? "var(--danger)" : cause ? "var(--warn)" : "var(--water)"}
        />
      )}
      {sensor && <Row k="Sensor" v={`${sensor.deviceId} · ${sensor.hardware ? "hardware" : "planned"}`} color="var(--water)" />}
      <p className="mt-3 font-mono text-[10px] text-[var(--faint)]">{b.id}</p>
    </Card>
  );
}

function PipeInfo({ world, id, water, tracer, setSim, sim }: P & { id: string }) {
  const pipe = world.water.pipes.find((x) => x.id === id);
  if (!pipe) return null;
  const node = (nid: string) => world.water.nodes.find((n) => n.id === nid)!;
  const from = node(pipe.from), to = node(pipe.to);
  const dirty = tracer ? (tracer.hops.get(pipe.from) ?? Infinity) < tracer.step && water.flowing.has(pipe.id) : false;
  const status = water.failedPipes.has(id) ? "ruptured" : dirty ? "contaminated" : water.flowing.has(id) ? "flowing" : "dry";
  return (
    <Card title={`Pipe · ${pipe.kind}`} right={<Source kind={sim ? "simulated" : "generated"} />}>
      <p className="font-mono text-sm">{id}</p>
      <Row k="System" v="Drinking water" />
      <Row k="From" v={`${from.name} (L${from.level})`} />
      <Row k="To" v={`${to.name} (L${to.level})`} />
      <Row k="Flow" v={from.level > to.level ? "upward (lifted)" : from.level < to.level ? "downward (gravity)" : "along the level"} />
      <Row k="Status" v={status} color={status === "flowing" ? "var(--water)" : status === "dry" ? "var(--muted)" : "var(--danger)"} />
      <button
        onClick={() => setSim({ title: `Pipe ${id} ruptures`, failure: { pipes: [id] } })}
        className="sim-hatch mt-3 w-full rounded-lg border border-[var(--sim)] px-3 py-1.5 text-sm text-[var(--sim)]"
      >
        Simulate a rupture here
      </button>
    </Card>
  );
}

function NodeInfo({ world, id, water, setSim, sim }: P & { id: string }) {
  const n = world.water.nodes.find((x) => x.id === id);
  if (!n) return null;
  const down = water.failedNodes.has(id);
  return (
    <Card title={n.kind} right={<Source kind={sim ? "simulated" : "generated"} />}>
      <p className="text-lg font-semibold">{n.name}</p>
      <Row k="Id" v={n.id} />
      <Row k="Level" v={`L${pad(n.level)}`} />
      <Row k="Status" v={down ? "failed (simulated)" : water.supplied.has(id) ? "running" : "no inflow"} color={down ? "var(--danger)" : "var(--water)"} />
      {n.kind !== "reservoir" && (
        <button
          onClick={() => setSim({ title: `${n.name} fails`, failure: { nodes: [id] } })}
          className="sim-hatch mt-3 w-full rounded-lg border border-[var(--sim)] px-3 py-1.5 text-sm text-[var(--sim)]"
        >
          Simulate a failure here
        </button>
      )}
    </Card>
  );
}

function HubInfo({ id, net }: P & { id: string }) {
  const h = net.hubs.find((x) => x.hubId === id);
  return (
    <Card title="Hub" right={<Source kind="live" />}>
      <p className="text-lg font-semibold">{id.replace("hub-", "Hub ")}</p>
      {!h ? (
        <p className="mt-2 text-sm text-[var(--muted)]">This hub isn&apos;t connected to this page. Set NEXT_PUBLIC_PEER_HUB_URL or ?peer=.</p>
      ) : (
        <>
          <Row k="Status" v={h.online ? "online" : "no answer"} color={h.online ? "var(--ok)" : "var(--danger)"} />
          <Row k="Outbound link" v={h.link ? (h.link.cut ? "cut" : "connected") : "—"} color={h.link?.cut ? "var(--danger)" : "var(--ok)"} />
          <Row k="Waiting to send" v={h.link?.queued ?? "—"} color={h.link?.queued ? "var(--warn)" : undefined} />
          <Row k="Forgeries refused here" v={h.rejectedTotal} />
          <Row k="Record chain" v={h.verify ? (h.verify.chain_intact ? "intact" : "tampered") : "—"} color={h.verify?.chain_intact === false ? "var(--danger)" : undefined} />
          {h.link && (
            <button
              onClick={() => net.actions.setLink(h, { cut: !h.link!.cut })}
              className="mt-3 w-full rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ background: h.link.cut ? "var(--ok)" : "var(--danger)" }}
            >
              {h.link.cut ? "Restore the link" : "Cut the link"}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function EventInfo({ world, id, events, net, directorate }: P & { id: string }) {
  const e = events.find((x) => x.id === id);
  if (!e) return null;
  const l = locate(e, world);
  const enc = isEncrypted(e);
  const verified = net.isVerified(e);
  const tampered = net.chain?.first_bad_event === e.id;
  return (
    <Card title={enc ? "Cell message" : TYPE_LABEL[e.type]} right={<Source kind={isSensor(e) ? "live" : "reported"} />}>
      <p className="text-base">
        {enc ? (directorate ? <span className="break-all font-mono text-xs text-[var(--directorate)]">{String(e.payload.ciphertext).slice(0, 64)}…</span> : "Encrypted for the cell.") : summary(e)}
      </p>
      <Row k="Level" v={`L${pad(e.level)} · ${world.levels[e.level - 1]?.name ?? ""}`} />
      <Row k="Placed" v={l.precision === "device" ? `at ${e.device_id}` : "level only (no exact spot reported)"} />
      <Row
        k="Signature"
        v={tampered ? "row edited after storing" : verified ? "verified · key on roster" : e.sig ? "unknown key" : "unsigned"}
        color={tampered ? "var(--danger)" : verified ? "var(--ok)" : "var(--warn)"}
      />
      <Row k="Hub" v={e.hub_id} />
      <Row k="Priority" v={e.priority === null ? "—" : e.priority.toFixed(2)} />
      {isSensor(e) && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          The sensor reports what it detected at its mounting point. Spread to other levels is not measured; run a simulation
          to estimate it.
        </p>
      )}
    </Card>
  );
}

function EventLine({ e, verified, directorate, onClick, now }: { e: HollowEvent; verified: boolean; directorate: boolean; onClick: () => void; now?: number }) {
  const sev = severityOf(e);
  const enc = isEncrypted(e);
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-start gap-2 text-left text-sm hover:text-[var(--foreground)]">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[sev] }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {enc ? (directorate ? "▓▓▓▓ encrypted ▓▓▓▓" : "Cell message (encrypted)") : summary(e)}
          </span>
          <span className="caption">
            L{pad(e.level)} · {TYPE_LABEL[e.type]}
            {now ? ` · ${timeAgo(e.created_at, now)}` : ""} ·{" "}
            <span style={{ color: verified ? "var(--ok)" : "var(--warn)" }}>{verified ? "verified" : e.sig ? "unknown key" : "unsigned"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

// --- Simulation panel ---------------------------------------------------------------------

function SimulationPanel({ world, sim, setSim, water, tracer, setFocus, setLayers, layers }: P) {
  const dryBuildings = [...water.cutOff.keys()].map((id) => world.buildings.find((b) => b.id === id)!).filter(Boolean);
  const dirtyBuildings = tracer ? world.buildings.filter((b) => (tracer.hops.get(b.id) ?? Infinity) <= tracer.step) : [];
  const hit = tracer ? dirtyBuildings : dryBuildings;
  const levels = [...new Set(hit.map((b) => b.level))].sort((a, b) => a - b);
  const people = hit.reduce((s, b) => s + b.population, 0);
  const hospitals = hit.filter((b) => b.kind === "hospital");
  const causes = [...new Set(water.cutOff.values())];

  return (
    <Card title="Simulation · water" right={<Source kind="simulated" />}>
      <div className="grid gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSim({ title: s.title, failure: s.failure, contaminate: s.contaminate });
              setFocus(null);
              if (layers.water !== "focus") setLayers({ ...layers, water: "focus" });
            }}
            className="rounded-lg border px-3 py-1.5 text-left text-sm"
            style={sim?.title === s.title ? { borderColor: "var(--sim)", color: "var(--sim)" } : { borderColor: "var(--border)" }}
            title={s.detail}
          >
            {s.title}
          </button>
        ))}
      </div>
      {sim && (
        <div className="sim-hatch mt-3 rounded-lg border border-[var(--sim)] p-3 text-sm">
          <p className="caption !text-[var(--sim)]">Simulated result · {sim.title}</p>
          {hit.length === 0 ? (
            <p className="mt-1">{tracer ? "The front hasn't reached a building yet…" : "No building loses water."}</p>
          ) : (
            <>
              <p className="mt-1">
                <strong>{hit.length}</strong> buildings on <strong>{levels.length}</strong> levels
                {levels.length ? ` (L${levels[0]}–L${levels[levels.length - 1]})` : ""}, about{" "}
                <strong>{people.toLocaleString()}</strong> residents, {tracer ? "reached by the contaminant" : "without water"}.
              </p>
              {hospitals.length > 0 && (
                <p className="mt-1 text-[var(--danger)]">Hospitals hit: {hospitals.map((h) => `${h.name} (L${h.level})`).join(", ")}</p>
              )}
              {!tracer && causes.length > 0 && <p className="mt-1 text-[var(--muted)]">Traced back to: {causes.join(", ")}</p>}
            </>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            A graph model of a generated network: no pressure or chemistry. Counts come from the code, not a sensor.
          </p>
          <button onClick={() => setSim(null)} className="mt-2 text-xs underline">
            Reset to normal
          </button>
        </div>
      )}
    </Card>
  );
}

// --- Live feed ------------------------------------------------------------------------------

function Feed({ events, net, setSelection, setFocus, directorate }: P) {
  const demo = net.mode === "demo";
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const recent = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  return (
    <Card
      title={`Live feed · ${events.length}`}
      right={
        demo ? (
          <button onClick={() => net.actions.demoSensorAlert(34)} className="caption underline hover:!text-[var(--foreground)]">
            + demo sensor alert
          </button>
        ) : (
          <Source kind="live" />
        )
      }
    >
      <ul className="space-y-2">
        {recent.map((e) => (
          <EventLine
            key={e.id}
            e={e}
            now={now}
            verified={net.isVerified(e)}
            directorate={directorate}
            onClick={() => {
              setFocus(e.level);
              setSelection({ type: "event", id: e.id });
            }}
          />
        ))}
        {recent.length === 0 && <li className="text-sm text-[var(--muted)]">No reports yet.</li>}
      </ul>
      <p className="mt-3 text-xs text-[var(--faint)]">The console is the proof of every check. This map shows where it happened.</p>
    </Card>
  );
}
