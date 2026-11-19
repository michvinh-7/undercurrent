"use client";

// The Hollow map: one level at a time, like a city map. Data flow:
//   useUndercurrent (hubs, live) → adapter (MapEvent) ┐
//   model (generated world, water solver)            ├→ CityScene (draws) + panels (explain)
// The map shows what happened; the hub's checks and counters (console) prove it.

import { useEffect, useMemo, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";
import { useUndercurrent } from "@/lib/useUndercurrent";
import { AppBar } from "@/components/app-bar";
import { adaptEvents, checkinStatus, isLungReport, isWaterReport, peopleIn, pinOf, SEVERITY_RANK, summarize, type MapEvent } from "./adapter";
import {
  addLevel, buildingById, createWorld, cutOffBuildings, destinations, floodedEdges, levelInlet, safeRoute, streetGraph, streetMain, traceSource, upstream,
  FACILITY_USES, levelOf, nameOf, pumpId, solveWater, USE_LABEL, type CityWorld, type Failure,
} from "./model";
import { narrate, type SensorFacts, type Story } from "./narrate";
import { activeSensorAlerts, buildingsNear, SENSOR_LOOK, type SensorAlert } from "./sensors";
import { isPreset, testEvent, type TestPreset } from "./panels/TestAlerts";
import type { HollowEvent } from "@/lib/types";
import CityScene, { sourcePoint, type HubView, type Layers, type Selection, type View, type Zone } from "./scene/CityScene";
import Briefs from "./panels/Briefs";
import Feed, { type FeedFilter } from "./panels/Feed";
import TestAlerts from "./panels/TestAlerts";
import Inspector from "./panels/Inspector";
import { LayerBar, MapBanners, MapKey, PaneToggle } from "./panels/MapChrome";
import { LevelStatus, NowCard } from "./panels/NowCard";
import SideTabs, { type Tab } from "./panels/SideTabs";
import TopBar from "./panels/TopBar";
import WhatIf from "./panels/WhatIf";

const EMPTY: ReadonlySet<string> = new Set();

const isCare = (u: string) => u === "hospital" || u === "clinic";

export default function CityApp() {
  const net = useUndercurrent();
  const [world, setWorld] = useState<CityWorld>(() => createWorld());
  const [active, setActive] = useState(34);
  const [view, setView] = useState<View>("3d");
  const [layers, setLayers] = useState<Layers>({ buildings: true, xray: false, water: true, network: true, alerts: true, sensors: false });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [focus, setFocus] = useState<{ x: number; z: number; key: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sim, setSim] = useState<{ label: string; failure: Failure } | null>(null);
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<Tab>("briefs");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [query, setQuery] = useState("");
  const [panes, setPanes] = useState({ left: true, right: true });
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("hollow.panes") ?? "null"); if (v && typeof v.left === "boolean") setPanes(v); } catch { /* private window: keep defaults */ }
  }, []);
  const togglePane = (k: "left" | "right") => setPanes((p) => {
    const next = { ...p, [k]: !p[k] };
    try { localStorage.setItem("hollow.panes", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const water = useMemo(() => solveWater(world, sim?.failure ?? {}), [world, sim]);
  const demo = net.mode === "demo";
  // Test alerts made on this page (sensor kinds the hardware doesn't send yet). Never sent to a hub.
  const [tests, setTests] = useState<HollowEvent[]>([]);
  const events = useMemo(() => adaptEvents([...net.events, ...tests], world, { isVerified: net.isVerified, demo }), [net.events, tests, net.isVerified, world, demo]);
  const fresh = useMemo(() => {
    const now = Date.now();
    return new Set(events.filter((e) => net.isFresh(e.id) || (e.test && now - e.time < 8000)).map((e) => e.id));
  }, [events, net]);
  // ?test=bad_air,blackout_soon preloads test alerts (for checking and filming). Presets: see TestAlerts.
  useEffect(() => {
    const list = new URLSearchParams(window.location.search).get("test");
    if (!list) return;
    const now = Date.now();
    setTests(list.split(",").filter((p): p is TestPreset => isPreset(p)).map((p, i) => testEvent(p, now - i * 1000)));
  }, []);
  const sendTest = (preset: TestPreset) => {
    const e = testEvent(preset);
    setTests((t) => [...t.filter((x) => x.device_id !== e.device_id || (x.payload as { kind?: string }).kind !== (e.payload as { kind?: string }).kind), e]);
    if (e.level >= 1 && world.levels.some((l) => l.n === e.level)) setActive(e.level);
  };

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
    const pin = pinOf(latest);
    if (pin) setFocus({ x: pin.x, z: pin.z, key: Date.now() });
  }, [events, fresh, follow]);

  const goLevel = (n: number) => {
    setActive(n);
    setSelection(null);
    setFocus(null);
  };
  const select = (s: Selection | null) => {
    setSelection(s);
    if (!s) { setTab((t) => (t === "selected" ? "feed" : t)); return; }
    setTab("selected");
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

  // Other sensor alerts on this level (bad air, heat, blackout): see sensors.ts for the rules.
  const alerts: SensorAlert[] = useMemo(() => (layers.alerts ? activeSensorAlerts(events, level.n).filter((a) => a.kind !== "flooding") : []), [events, level.n, layers.alerts]);
  const zones: Zone[] = useMemo(() => alerts.filter((a) => a.at).map((a) => {
    const kind = a.kind as Zone["kind"];
    const label = kind === "bad_air" ? `Bad air${a.reading ? ` · ${a.reading}` : ""}`
      : kind === "heat" ? `Hot${a.reading ? ` · ${a.reading}` : ""}`
      : a.expectedIn !== null ? `⚡ Blackout in ~${a.expectedIn} min` : "⚡ No power";
    return { id: a.event.id, kind, at: a.at!, radius: SENSOR_LOOK[kind].radius, label, color: SENSOR_LOOK[kind].color, warning: a.expectedIn !== null };
  }), [alerts]);
  const dark = useMemo(() => {
    const out = new Set<string>();
    for (const a of alerts) if (a.kind === "blackout" && a.expectedIn === null) for (const id of buildingsNear(level.buildings, a.at, SENSOR_LOOK.blackout.radius)) out.add(id);
    return out;
  }, [alerts, level]);
  const badAir = alerts.find((a) => a.kind === "bad_air" && a.at);
  const blocked = useMemo(() => {
    const out = new Set(flood?.blocked ?? []);
    for (const a of alerts) if (a.at && SENSOR_LOOK[a.kind].blocksStreets) for (const id of floodedEdges(world.grid, a.at, SENSOR_LOOK[a.kind].radius)) out.add(id);
    return out;
  }, [flood, alerts, world.grid]);

  // The way to care: from a clicked building, or out of the flood (or bad air), around anything unsafe.
  const selBuilding = selection?.type === "building" ? buildingById(world, selection.id) : undefined;
  const route = useMemo(() => {
    const fromBuilding = selBuilding && selBuilding.level === level.n && !isCare(selBuilding.use);
    const from = fromBuilding ? selBuilding!.center : flood?.at ?? badAir?.at;
    if (!from) return null;
    const care = destinations(level, ["hospital", "clinic"]);
    const r = safeRoute(world.grid, from, care.length ? care : destinations(level, ["shelter"]), blocked);
    return r ? { ...r, kind: care.length ? ("care" as const) : ("shelter" as const) } : null;
  }, [flood, badAir, blocked, level, world.grid, selBuilding]);

  // Bad water: trace every report up the pipes and look for the element they share.
  const trace = useMemo(() => {
    const chains = events.filter((e) => isWaterReport(e) && e.onMap && e.level !== null).map((e) => {
      const n = e.level!;
      if (e.place.kind === "named" && e.place.building) { const t = world.network.tapOf.get(e.place.building); return t ? upstream(world, t.pipe) : []; }
      if (e.place.kind === "named" && e.place.street) { const m = streetMain(world, n, e.place.street); if (m) return upstream(world, m); }
      const inlet = levelInlet(world, n);
      return inlet ? [pumpId(n), ...upstream(world, inlet)] : [];
    });
    return { chains: chains.length, result: traceSource(world, chains) };
  }, [events, world]);
  const showTrace = layers.water && trace.result ? trace.result : null;

  // Nearest care for this level, in words (another level if this one has none).
  const care = useMemo(() => {
    const here = destinations(level, ["hospital", "clinic"]);
    if (here.length) return `the ${here[0].name} on this level`;
    const other = world.levels.filter((l) => l.n !== level.n && destinations(l, ["hospital", "clinic"]).length).sort((a, b) => Math.abs(a.n - level.n) - Math.abs(b.n - level.n))[0];
    if (!other) return null;
    const d = other.n - level.n;
    return `the ${destinations(other, ["hospital", "clinic"])[0].name} on L${other.n}, ${Math.abs(d)} level${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "up" : "down"}`;
  }, [level, world]);

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
      selected: selBuilding && selBuilding.level === level.n ? {
        name: selBuilding.use === "housing" || selBuilding.use === "workshop" ? `${USE_LABEL[selBuilding.use]} on L${level.n}` : selBuilding.name,
        care: route && !isCare(selBuilding.use) ? { to: route.to, minutes: route.minutes, via: route.via, kind: route.kind } : null,
        isCare: isCare(selBuilding.use),
        avoidsFlood: !!flood && flood.blocked.size > 0, atRisk: !!showTrace?.atRisk.has(selBuilding.id), dry: water.dry.has(selBuilding.id),
      } : null,
      water: showTrace && [...showTrace.atRisk].some((id) => id.startsWith(`L${level.n}/`)) ? { source: nameOf(world, showTrace.source), reports: showTrace.reports, atRisk: showTrace.atRisk.size } : null,
      waterReports: trace.result ? 0 : trace.chains,
      lungs: (() => { const l = events.filter((e) => e.level === level.n && isLungReport(e)); return l.length ? { reports: l.length, people: l.reduce((t, e) => t + peopleIn(e), 0) } : null; })(),
      checkins: (() => { const c = events.filter((e) => e.level === level.n).map(checkinStatus).filter(Boolean); return { ok: c.filter((x) => x === "ok").length, help: c.filter((x) => x === "need_help").length }; })(),
      care,
      sensors: [...alerts].sort((a, b) => sensorRank(a) - sensorRank(b)).map((a): SensorFacts => ({
        kind: a.kind as SensorFacts["kind"],
        where: (a.event.event.device_id && nameOf(world, world.sensors.find((m) => m.deviceId === a.event.event.device_id)?.building ?? "")) || `L${level.n}`,
        ago: timeAgo(a.event.event.created_at), reading: a.reading, expectedIn: a.expectedIn,
        verified: a.event.verified, demo: a.event.demo, test: a.event.test,
        route: a.kind === "bad_air" && route && !flood && !selBuilding ? { to: route.to, minutes: route.minutes } : null,
      })),
    });
  }, [world, level, flood, floodEvent, cut, route, spread, sim, water, hubs, events, sums, demo, selBuilding, showTrace, trace, care, alerts]);

  const feedPick = (e: MapEvent) => { select({ type: "event", id: e.id }); const pin = pinOf(e); if (pin) setFocus({ x: pin.x, z: pin.z, key: Date.now() }); };
  const simOn = !!(sim && (sim.failure.nodes?.length || sim.failure.pipes?.length));

  const now = (
    <NowCard story={story} level={level.n} name={level.name} flood={!!flood} spread={spread} setSpread={setSpread}>
      <LevelStatus world={world} level={level.n} events={events} water={water} hubs={hubs} sim={sim} />
    </NowCard>
  );
  // Where the bad-water trace points, for the Briefs (question 4).
  const traceLevel = showTrace ? [...showTrace.atRisk][0]?.match(/^L(\d+)\//)?.[1] : undefined;
  const briefInput = {
    events, levels: world.levels.map((l) => l.n), forgeriesBlocked: net.forgeriesBlocked,
    water: showTrace && traceLevel ? { source: nameOf(world, showTrace.source).replace(/^./, (c) => c.toLowerCase()), reports: showTrace.reports, atRisk: showTrace.atRisk.size, level: Number(traceLevel) } : null,
  };
  const briefActions = {
    goTo: (n: number, e?: MapEvent) => {
      setActive(n);
      if (e) feedPick(e); else { setSelection(null); setFocus(null); }
    },
    openFeed: (f: FeedFilter) => { setFeedFilter(f); setTab("feed"); },
    test: sendTest,
    showWater: () => {
      if (!briefInput.water || !showTrace) return;
      setLayers((l) => ({ ...l, water: true }));
      setActive(briefInput.water.level);
      setSelection(null);
      const at = sourcePoint(world, briefInput.water.level, showTrace.source);
      if (at) setFocus({ x: at[0], z: at[1], key: Date.now() });
    },
  };

  const tabs = (
    <SideTabs
      tab={tab} setTab={setTab} hasSelection={!!selection} simOn={simOn} count={events.length}
      briefs={<Briefs input={briefInput} actions={briefActions} />}
      selected={selection && <Inspector world={world} selection={selection} events={events} water={water} net={net} hubs={hubs} onClose={() => select(null)} onFocus={() => focusOn(selection)} onSim={(label, failure) => { setSim({ label, failure }); }} sim={sim} />}
      whatIf={
        <div className="flex flex-col gap-3">
          <WhatIf world={world} level={level.n} sim={sim} setSim={setSim} water={water} />
          <TestAlerts onSend={sendTest} onClear={() => setTests([])} count={tests.length} />
        </div>
      }
      feed={<Feed events={events} fresh={fresh} demo={demo} onPick={feedPick} onDemoAlert={() => net.actions.demoSensorAlert(34)} filter={feedFilter} setFilter={setFeedFilter} query={query} setQuery={setQuery} />}
    />
  );

  // Desktop: header, then three columns, one question each:
  //   left "what's happening here" | middle "where" (the map) | right "details": feed, selected, what-if.
  // Panels sit beside the map, never on top of it, and either side can collapse.
  // Below xl the right column folds under the left one. Phone: map on top, one sheet underneath.
  return (
    <div className="theme-paper flex h-[100dvh] w-full flex-col overflow-hidden">
      <AppBar net={net} />
      <TopBar
        net={net} world={world} active={level.n} sums={sums} view={view} setView={setView} follow={follow} setFollow={setFollow}
        onLevel={goLevel} onReset={() => { setFocus(null); select(null); setResetKey((k) => k + 1); }}
        onAdd={(n) => { setWorld((w) => addLevel(w, n)); goLevel(n); }}
      />

      <div
        className="flex min-h-0 flex-1 flex-col transition-[grid-template-columns] duration-200 md:grid md:grid-cols-[var(--left)_minmax(0,1fr)] xl:grid-cols-[var(--left)_minmax(0,1fr)_var(--right)]"
        style={{ "--left": panes.left ? "320px" : "0px", "--right": panes.right ? "340px" : "0px" } as React.CSSProperties}
      >
        <aside className={`hidden min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-r border-[var(--border)] bg-[var(--background)] p-3 md:flex [&>*]:shrink-0 ${panes.left ? "" : "invisible border-r-0 p-0"}`} aria-label="This level">
          {now}
          <div className="flex flex-col gap-3 xl:hidden [&>*]:shrink-0">{tabs}</div>
        </aside>

        <main className="relative h-[55dvh] min-w-0 shrink-0 md:h-auto md:min-h-0">
          <CityScene
            world={world} active={level.n} view={view} layers={layers} water={water} selection={selection}
            onSelect={select} onLevel={goLevel} events={events} fresh={fresh} hubs={hubs} packetKey={packetKey}
            focus={focus} resetKey={resetKey} flood={flood} route={route} cut={cut} zones={zones} dark={dark}
            trace={showTrace ? { pipes: showTrace.pipes, source: showTrace.source } : null} risk={showTrace?.atRisk ?? EMPTY}
          />

          {/* Top of the map: collapse buttons at the edges, banners in the middle. */}
          <PaneToggle side="left" open={panes.left} onClick={() => togglePane("left")} />
          <PaneToggle side="right" open={panes.right} onClick={() => togglePane("right")} />
          <MapBanners sim={simOn ? sim!.label : flood && spread ? "Flood keeps rising" : null} demo={demo} onExit={() => { setSim(null); setSpread(false); }} />

          {/* Bottom of the map: layers left, key right. */}
          <LayerBar layers={layers} onToggle={(id) => setLayers((s) => ({ ...s, [id]: !s[id] }))} />
          <MapKey />
        </main>

        <aside className={`hidden min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] p-3 xl:flex [&>*]:shrink-0 ${panes.right ? "" : "invisible border-l-0 p-0"}`} aria-label="Details">
          {tabs}
        </aside>

        {/* Phone: one sheet under the map. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t border-[var(--border)] bg-[var(--background)] p-2 md:hidden [&>*]:shrink-0">
          {now}
          {tabs}
        </div>
      </div>
    </div>
  );
}

/** Which sensor story leads: a coming blackout first (there's still time to act), then bad air, then the rest. */
function sensorRank(a: SensorAlert): number {
  if (a.kind === "blackout" && a.expectedIn !== null) return 0;
  return a.kind === "bad_air" ? 1 : a.kind === "blackout" ? 2 : 3;
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
      const pin = pinOf(e);
      return pin ? { level: e.level, x: pin.x, z: pin.z } : { level: e.level };
    }
  }
}

function streetNamesFor(world: CityWorld, edgeIds: string[]): string[] {
  const g = streetGraph(world.grid);
  return edgeIds.map((id) => g.edges.find((e) => e.id === id)?.street).filter((x): x is string => !!x);
}
