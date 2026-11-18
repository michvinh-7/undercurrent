// The Hollow as a city map: a street grid every level shares, a seeded layout per level,
// a water network derived from whichever levels exist, and the "what if" solver.
//
// Units are meters. x runs east, z runs south, y is up. Every level uses the same x/z,
// so a spot on L34 sits directly under the same spot on L12.
//
// Everything in here is GENERATED (labelled simulated in the UI). Live events never
// live in the world: they stay in useUndercurrent, so adding a level can't touch them.
// Pure TypeScript with no runtime imports, so `node --test` can load it directly.

export type XZ = [number, number];

// --- Seeded randomness -----------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (a: number, b: number) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;

// --- Shared layout ------------------------------------------------------------------------

export const CITY = { width: 280, depth: 180, corner: 34 };
export const PLAZA_RADIUS = 27;
export const LEVEL_SPACING = 25; // meters between floors of the Hollow, for elevation only
export const CEILING = 16;
/** Fixed spots in the central plaza. Vertical shafts line up on every level. */
export const CORE = {
  riser: [8, 8] as XZ,
  pump: [15, 14] as XZ,
  link: [12, -12] as XZ,
  air: [-12, -12] as XZ,
  cistern: [-14, 14] as XZ,
};
export const CISTERN_RADIUS = 7;

export interface Street {
  id: string;
  name: string;
  /** "ns" streets run north–south at x = at; "ew" streets run east–west at z = at. */
  dir: "ns" | "ew";
  at: number;
  width: number;
  from: number;
  to: number;
}

export interface Grid {
  outline: XZ[];
  streets: Street[];
}

const NS_NAMES = ["Lantern Ave", "Cistern Row", "Shaft Boulevard", "Pumpwell St", "Ferrous Ave"];
const EW_NAMES = ["North Gallery", "Central Way", "South Gallery"];

export function insideOutline([x, z]: XZ, margin = 0): boolean {
  const hw = CITY.width / 2 - margin, hd = CITY.depth / 2 - margin, r = Math.max(0, CITY.corner - margin);
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > hw || az > hd) return false;
  if (ax <= hw - r || az <= hd - r) return true;
  return Math.hypot(ax - (hw - r), az - (hd - r)) <= r;
}

function roundedRect(w: number, d: number, r: number, steps = 8): XZ[] {
  const pts: XZ[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, -d / 2 + r, -Math.PI / 2], [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI],
  ];
  for (const [cx, cz, a0] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  return pts;
}

export function makeGrid(seed: number): Grid {
  const rnd = mulberry32(mix(seed, 1));
  const jit = (v: number) => (v === 0 ? 0 : v + Math.round((rnd() - 0.5) * 10));
  const xs = [-100, -50, 0, 50, 100].map(jit);
  const zs = [-55, 0, 55].map(jit);
  const streets: Street[] = [
    ...xs.map((at, i): Street => ({ id: `ns${i}`, name: NS_NAMES[i], dir: "ns", at, width: at === 0 ? 10 : 7, from: -CITY.depth / 2 + 7, to: CITY.depth / 2 - 7 })),
    ...zs.map((at, i): Street => ({ id: `ew${i}`, name: EW_NAMES[i], dir: "ew", at, width: at === 0 ? 10 : 7, from: -CITY.width / 2 + 7, to: CITY.width / 2 - 7 })),
  ];
  return { outline: roundedRect(CITY.width, CITY.depth, CITY.corner), streets };
}

// --- One level ------------------------------------------------------------------------------

export type BuildingUse =
  | "housing" | "workshop" | "market" | "clinic" | "hospital" | "shelter" | "school" | "relay" | "pumphouse";

export const USE_LABEL: Record<BuildingUse, string> = {
  housing: "Housing", workshop: "Workshop", market: "Market hall", clinic: "Clinic", hospital: "Hospital",
  shelter: "Shelter", school: "School", relay: "Relay station", pumphouse: "Lift station",
};
export const FACILITY_USES: BuildingUse[] = ["hospital", "clinic", "shelter", "school", "market", "relay", "pumphouse"];

export interface Footprint { outer: XZ[]; holes: XZ[][] }

export interface Building {
  id: string;
  level: number;
  use: BuildingUse;
  name: string;
  footprint: Footprint;
  height: number;
  center: XZ;
  area: number;
  /** Generated estimate. There is no real resident registry. */
  residents: number;
}

export interface OpenSpace { id: string; level: number; kind: "park" | "yard"; poly: XZ[] }

export interface Level {
  n: number;
  name: string;
  elevation: number;
  /** Paved city blocks (between streets). */
  blocks: XZ[][];
  open: OpenSpace[];
  buildings: Building[];
  /** True for the level that holds the cistern tank. */
  cistern: boolean;
}

interface LevelInfo { name: string; facilities: BuildingUse[] }
const KNOWN_LEVELS: Record<number, LevelInfo> = {
  12: { name: "North relay", facilities: ["relay", "clinic", "shelter", "market"] },
  34: { name: "Pump room", facilities: ["hospital", "shelter", "market", "school"] },
  35: { name: "Cistern", facilities: ["clinic", "shelter", "workshop"] },
};
const NAME_POOL = ["Lamp Market", "Old Galleries", "Deep Works", "Saltway", "Foundry", "Low Commons", "Root Cellars", "Echo Halls", "Ironside", "Drip Quarter"];
export const CISTERN_LEVEL = 35;

const area = (p: XZ[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

const rectDistToOrigin = (x0: number, z0: number, x1: number, z1: number) => Math.hypot(Math.max(x0, -x1, 0), Math.max(z0, -z1, 0));

function footprintIn(rnd: () => number, x0: number, z0: number, x1: number, z1: number): Footprint {
  const w = x1 - x0, d = z1 - z0, roll = rnd();
  if (roll < 0.45 || w < 10 || d < 10) return { outer: rect(x0, z0, x1, z1), holes: [] };
  if (roll < 0.72) {
    // L-shape: cut one corner away.
    const cw = w * (0.35 + rnd() * 0.15), cd = d * (0.35 + rnd() * 0.15), c = Math.floor(rnd() * 4);
    const pts: XZ[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const [cx, cz] = pts[c];
    const sx = cx === x0 ? 1 : -1, sz = cz === z0 ? 1 : -1;
    const cut: XZ[] = c % 2 === 0
      ? [[cx, cz + sz * cd], [cx + sx * cw, cz + sz * cd], [cx + sx * cw, cz]]
      : [[cx + sx * cw, cz], [cx + sx * cw, cz + sz * cd], [cx, cz + sz * cd]];
    return { outer: [...pts.slice(0, c), ...cut, ...pts.slice(c + 1)], holes: [] };
  }
  if (roll < 0.86 && w > 18 && d > 18) {
    // Courtyard block.
    const ix = Math.max(4, w * 0.3), iz = Math.max(4, d * 0.3);
    return { outer: rect(x0, z0, x1, z1), holes: [rect(x0 + ix, z0 + iz, x1 - ix, z1 - iz)] };
  }
  // U-shape: a notch in the middle of the north or south face.
  const nw = w * 0.36, nd = d * 0.4, mx = (x0 + x1) / 2;
  return rnd() < 0.5
    ? { outer: [[x0, z0], [mx - nw / 2, z0], [mx - nw / 2, z0 + nd], [mx + nw / 2, z0 + nd], [mx + nw / 2, z0], [x1, z0], [x1, z1], [x0, z1]], holes: [] }
    : { outer: [[x0, z0], [x1, z0], [x1, z1], [mx + nw / 2, z1], [mx + nw / 2, z1 - nd], [mx - nw / 2, z1 - nd], [mx - nw / 2, z1], [x0, z1]], holes: [] };
}

function heightFor(use: BuildingUse, rnd: () => number) {
  const r = (a: number, b: number) => +(a + rnd() * (b - a)).toFixed(1);
  switch (use) {
    case "housing": return r(5, 12);
    case "workshop": return r(4, 7);
    case "market": return r(5, 7);
    case "pumphouse": return 5;
    default: return r(9, 13);
  }
}

export function generateLevel(seed: number, grid: Grid, n: number): Level {
  const rnd = mulberry32(mix(seed, 1000 + n));
  const info: LevelInfo = KNOWN_LEVELS[n] ?? {
    name: NAME_POOL[Math.floor(rnd() * NAME_POOL.length)],
    facilities: (["clinic", "shelter", "market", "school", "workshop"] as BuildingUse[]).filter(() => rnd() < 0.6),
  };

  // Blocks: the cells between street lines, shrunk by half the street plus a sidewalk.
  const cuts = (dir: "ns" | "ew", lo: number, hi: number) => {
    const ss = grid.streets.filter((s) => s.dir === dir).sort((a, b) => a.at - b.at);
    const edges: [number, number][] = [];
    let prev = lo;
    for (const s of ss) { edges.push([prev, s.at - s.width / 2 - 2]); prev = s.at + s.width / 2 + 2; }
    edges.push([prev, hi]);
    return edges;
  };
  const xCells = cuts("ns", -CITY.width / 2 + 4, CITY.width / 2 - 4);
  const zCells = cuts("ew", -CITY.depth / 2 + 4, CITY.depth / 2 - 4);

  const blocks: XZ[][] = [];
  const lots: [number, number, number, number][] = [];
  for (const [x0, x1] of xCells)
    for (const [z0, z1] of zCells) {
      blocks.push(rect(x0, z0, x1, z1));
      const split = (a0: number, b0: number, a1: number, b1: number, depth: number) => {
        const w = a1 - a0, d = b1 - b0, max = 18 + rnd() * 14;
        if ((w <= max && d <= max) || depth > 6) { lots.push([a0, b0, a1, b1]); return; }
        const t = 0.36 + rnd() * 0.28;
        if (w >= d) { const m = a0 + w * t; split(a0, b0, m, b1, depth + 1); split(m, b0, a1, b1, depth + 1); }
        else { const m = b0 + d * t; split(a0, b0, a1, m, depth + 1); split(a0, m, a1, b1, depth + 1); }
      };
      split(x0, z0, x1, z1, 0);
    }

  // Keep lots fully inside the cavern and clear of the plaza.
  const usable = lots.filter(([x0, z0, x1, z1]) =>
    [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].every((p) => insideOutline(p as XZ, 3)) &&
    rectDistToOrigin(x0, z0, x1, z1) > PLAZA_RADIUS + 3 &&
    x1 - x0 > 8 && z1 - z0 > 8,
  );

  // Facilities take the biggest lots nearest the plaza; the rest are housing, workshops, parks.
  const byPriority = usable
    .map((l, i) => ({ l, i, score: (l[2] - l[0]) * (l[3] - l[1]) - 6 * Math.hypot((l[0] + l[2]) / 2, (l[1] + l[3]) / 2) }))
    .sort((a, b) => b.score - a.score);
  const facilityLot = new Map<number, BuildingUse>();
  info.facilities.forEach((use, k) => { if (byPriority[k]) facilityLot.set(byPriority[k].i, use); });

  const buildings: Building[] = [];
  const open: OpenSpace[] = [];
  const counts: Partial<Record<BuildingUse, number>> = {};
  usable.forEach(([x0, z0, x1, z1], i) => {
    const pin = rnd(), shape = mulberry32(mix(seed, n * 7919 + i));
    let use: BuildingUse | null = facilityLot.get(i) ?? null;
    if (!use) {
      if (pin < 0.1) { open.push({ id: `L${n}/park-${i}`, level: n, kind: "park", poly: rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1) }); return; }
      if (pin < 0.15) { open.push({ id: `L${n}/yard-${i}`, level: n, kind: "yard", poly: rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1) }); return; }
      use = pin < 0.78 ? "housing" : "workshop";
    }
    const s = 1.6;
    const fp = facilityLot.has(i) ? { outer: rect(x0 + s, z0 + s, x1 - s, z1 - s), holes: [] } : footprintIn(shape, x0 + s, z0 + s, x1 - s, z1 - s);
    const a = area(fp.outer) - fp.holes.reduce((t, h) => t + area(h), 0);
    const height = heightFor(use, rnd);
    const floors = Math.max(1, Math.floor(height / 3.2));
    const residents = use === "housing" ? Math.round((a * floors) / 32) : use === "shelter" ? Math.round(a / 6) : 0;
    counts[use] = (counts[use] ?? 0) + 1;
    const name = use === "housing" || use === "workshop" ? `${USE_LABEL[use]} ${n}-${i}` : `L${n} ${USE_LABEL[use]}${counts[use]! > 1 ? ` ${counts[use]}` : ""}`;
    buildings.push({ id: `L${n}/b${i}`, level: n, use, name, footprint: fp, height, center: [(x0 + x1) / 2, (z0 + z1) / 2], area: Math.round(a), residents });
  });

  // The lift station sits in the plaza on every level, next to the riser.
  const [px, pz] = CORE.pump;
  buildings.push({
    id: `L${n}/pump`, level: n, use: "pumphouse", name: `Lift station ${n}`,
    footprint: { outer: rect(px - 3.5, pz - 3, px + 3.5, pz + 3), holes: [] }, height: 5, center: [px, pz], area: 42, residents: 0,
  });

  return { n, name: info.name, elevation: -n * LEVEL_SPACING, blocks, open, buildings, cistern: n === CISTERN_LEVEL };
}

// --- Water network (derived) ------------------------------------------------------------

export type NodeKind = "source" | "riser" | "pump" | "junction";
export interface WNode { id: string; level: number; kind: NodeKind; x: number; z: number; label: string }
export type PipeKind = "riser" | "feed" | "main";
export interface WPipe { id: string; kind: PipeKind; level: number; from: string; to: string; label: string }
/** Where a building's service line meets a main. */
export interface Tap { building: string; level: number; pipe: string; at: XZ }

export interface Network {
  nodes: WNode[];
  pipes: WPipe[];
  taps: Tap[];
  node: Map<string, WNode>;
  pipe: Map<string, WPipe>;
  /** Each node's single upstream pipe (the network is a tree from the cistern). */
  feeds: Map<string, string>;
  tapOf: Map<string, Tap>;
}

const nid = (n: number, s: string) => `L${n}/${s}`;
export const pumpId = (n: number) => nid(n, "P");
export const riserId = (n: number) => nid(n, "R");
export const SOURCE_ID = "cistern";

function segDist([px, pz]: XZ, [ax, az]: XZ, [bx, bz]: XZ): { d: number; at: XZ } {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0.05, Math.min(0.95, ((px - ax) * dx + (pz - az) * dz) / len2));
  const at: XZ = [ax + t * dx, az + t * dz];
  return { d: Math.hypot(px - at[0], pz - at[1]), at };
}

export function buildNetwork(grid: Grid, levels: Level[]): Network {
  const nodes: WNode[] = [], pipes: WPipe[] = [], taps: Tap[] = [];
  const add = (p: Omit<WPipe, "id">) => pipes.push({ ...p, id: `${p.from}>${p.to}` });
  const sorted = [...levels].sort((a, b) => a.n - b.n);
  if (!sorted.length) return finish(nodes, pipes, taps);

  const sourceLevel = sorted.find((l) => l.cistern)?.n ?? sorted[sorted.length - 1].n;
  nodes.push({ id: SOURCE_ID, level: sourceLevel, kind: "source", x: CORE.cistern[0], z: CORE.cistern[1], label: `Cistern (L${sourceLevel})` });

  // Riser: one node per level, piped outward from the cistern's level.
  for (const l of sorted) nodes.push({ id: riserId(l.n), level: l.n, kind: "riser", x: CORE.riser[0], z: CORE.riser[1], label: `Riser at L${l.n}` });
  add({ kind: "feed", level: sourceLevel, from: SOURCE_ID, to: riserId(sourceLevel), label: "Cistern outlet" });
  const si = sorted.findIndex((l) => l.n === sourceLevel);
  for (let i = si; i > 0; i--) add({ kind: "riser", level: sorted[i].n, from: riserId(sorted[i].n), to: riserId(sorted[i - 1].n), label: `Riser L${sorted[i].n}→L${sorted[i - 1].n}` });
  for (let i = si; i < sorted.length - 1; i++) add({ kind: "riser", level: sorted[i].n, from: riserId(sorted[i].n), to: riserId(sorted[i + 1].n), label: `Riser L${sorted[i].n}→L${sorted[i + 1].n}` });

  const ns = grid.streets.filter((s) => s.dir === "ns").sort((a, b) => a.at - b.at);
  const ew = grid.streets.filter((s) => s.dir === "ew").sort((a, b) => a.at - b.at);
  for (const l of sorted) {
    const n = l.n;
    nodes.push({ id: pumpId(n), level: n, kind: "pump", x: CORE.pump[0], z: CORE.pump[1], label: `Lift station ${n}` });
    add({ kind: "feed", level: n, from: riserId(n), to: pumpId(n), label: `Riser to lift station ${n}` });

    // Junctions at every crossing, plus where each street ends.
    const key = (i: number, j: number) => nid(n, `J${i}.${j}`);
    const pos = new Map<string, XZ>();
    const zLine = [ns[0].from, ...ew.map((s) => s.at), ns[0].to];
    const xLine = [ew[0].from, ...ns.map((s) => s.at), ew[0].to];
    // Crossings (i over avenues, j over streets) and ends.
    ns.forEach((s, i) => zLine.forEach((z, j) => pos.set(key(i + 1, j), [s.at, z])));
    ew.forEach((s, j) => { pos.set(key(0, j + 1), [xLine[0], s.at]); pos.set(key(ns.length + 1, j + 1), [xLine[xLine.length - 1], s.at]); });
    for (const [id, [x, z]] of pos) nodes.push({ id, level: n, kind: "junction", x, z, label: "Junction" });

    // Spanning tree by breadth-first search from the plaza crossing (deterministic order).
    const ci = ns.findIndex((s) => s.at === 0) + 1, cj = ew.findIndex((s) => s.at === 0) + 1;
    const root = key(ci, cj);
    add({ kind: "feed", level: n, from: pumpId(n), to: root, label: `Lift station ${n} outlet` });
    const seen = new Set([root]);
    const queue = [[ci, cj]];
    while (queue.length) {
      const [i, j] = queue.shift()!;
      for (const [di, dj] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const a = key(i, j), b = key(i + di, j + dj);
        if (!pos.has(b) || seen.has(b)) continue;
        // Only along an actual street: same avenue (di=0, inner i) or same street (dj=0, inner j).
        if (di === 0 && (i === 0 || i === ns.length + 1)) continue;
        if (dj === 0 && (j === 0 || j === ew.length + 1)) continue;
        seen.add(b);
        queue.push([i + di, j + dj]);
        const street = di === 0 ? ns[i - 1] : ew[j - 1];
        add({ kind: "main", level: n, from: a, to: b, label: `Main under ${street.name}` });
      }
    }

    // Service taps: each building joins the nearest main on its level.
    const mains = pipes.filter((p) => p.level === n && p.kind === "main");
    for (const b of l.buildings) {
      if (b.use === "pumphouse") continue;
      let best: { d: number; at: XZ; pipe: string } | null = null;
      for (const p of mains) {
        const r = segDist(b.center, pos.get(p.from)!, pos.get(p.to)!);
        if (!best || r.d < best.d) best = { ...r, pipe: p.id };
      }
      if (best) taps.push({ building: b.id, level: n, pipe: best.pipe, at: best.at });
    }
  }
  return finish(nodes, pipes, taps);
}

function finish(nodes: WNode[], pipes: WPipe[], taps: Tap[]): Network {
  return {
    nodes, pipes, taps,
    node: new Map(nodes.map((x) => [x.id, x])),
    pipe: new Map(pipes.map((x) => [x.id, x])),
    feeds: new Map(pipes.map((p) => [p.to, p.id])),
    tapOf: new Map(taps.map((t) => [t.building, t])),
  };
}

// --- The world -------------------------------------------------------------------------

export interface HubSite { hubId: string; level: number; x: number; z: number }
export interface SensorMount { deviceId: string; level: number; x: number; z: number; y: number; building: string; hardware: boolean }

export interface CityWorld {
  seed: number;
  grid: Grid;
  levels: Level[];
  network: Network;
  hubs: HubSite[];
  sensors: SensorMount[];
}

/** The two hubs in the demo. One place to change if the team switches the level pair. */
export const HUB_LEVELS = [34, 12];
export const INITIAL_LEVELS = [34, 35, 12];
export const DEFAULT_SEED = 48291;

function derive(seed: number, grid: Grid, levels: Level[]): CityWorld {
  const sorted = [...levels].sort((a, b) => a.n - b.n);
  const have = new Set(sorted.map((l) => l.n));
  return {
    seed, grid, levels: sorted,
    network: buildNetwork(grid, sorted),
    hubs: HUB_LEVELS.filter((n) => have.has(n)).map((n) => ({ hubId: `hub-L${n}`, level: n, x: CORE.link[0], z: CORE.link[1] })),
    // canary-34 is mounted in the L34 lift station (the box Tisya builds).
    sensors: have.has(34) ? [{ deviceId: "canary-34", level: 34, x: CORE.pump[0] - 2.4, z: CORE.pump[1] - 3.2, y: 2.2, building: "L34/pump", hardware: true }] : [],
  };
}

export function createWorld(seed = DEFAULT_SEED, levels = INITIAL_LEVELS): CityWorld {
  const grid = makeGrid(seed);
  return derive(seed, grid, [...new Set(levels)].map((n) => generateLevel(seed, grid, n)));
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 40;

/**
 * Add a level. Existing Level objects are reused as-is (same references, same ids), so
 * nothing already on the map moves or regenerates; only the derived network is rebuilt.
 * Adding a level that exists returns the same world.
 */
export function addLevel(world: CityWorld, n: number): CityWorld {
  if (!Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL) throw new Error(`Level must be a whole number from ${MIN_LEVEL} to ${MAX_LEVEL}`);
  if (world.levels.some((l) => l.n === n)) return world;
  return derive(world.seed, world.grid, [...world.levels, generateLevel(world.seed, world.grid, n)]);
}

export const levelOf = (world: CityWorld, n: number) => world.levels.find((l) => l.n === n);
export const buildingById = (world: CityWorld, id: string) => {
  const n = Number(id.slice(1, id.indexOf("/")));
  return levelOf(world, n)?.buildings.find((b) => b.id === id);
};

// --- What if: who loses water ---------------------------------------------------------

export interface Failure { nodes?: string[]; pipes?: string[] }
export interface WaterState {
  supplied: Set<string>;
  flowing: Set<string>;
  failed: Set<string>;
  /** Building id → id of the failed element that cut it off. */
  dry: Map<string, string>;
}

export function solveWater(world: CityWorld, failure: Failure = {}): WaterState {
  const { network: net } = world;
  const failed = new Set([...(failure.nodes ?? []), ...(failure.pipes ?? [])]);
  const out = new Map<string, WPipe[]>();
  for (const p of net.pipes) (out.get(p.from) ?? out.set(p.from, []).get(p.from)!).push(p);
  const supplied = new Set<string>(), flowing = new Set<string>();
  if (net.node.has(SOURCE_ID) && !failed.has(SOURCE_ID)) {
    supplied.add(SOURCE_ID);
    const queue = [SOURCE_ID];
    while (queue.length) {
      const id = queue.shift()!;
      for (const p of out.get(id) ?? []) {
        if (failed.has(p.id)) continue;
        flowing.add(p.id);
        if (failed.has(p.to) || supplied.has(p.to)) continue;
        supplied.add(p.to);
        queue.push(p.to);
      }
    }
  }
  const dry = new Map<string, string>();
  for (const t of net.taps) {
    if (flowing.has(t.pipe)) continue;
    dry.set(t.building, blame(world, t.pipe, failed));
  }
  return { supplied, flowing, failed, dry };
}

/** Walk upstream from a pipe to the first failed element. */
function blame(world: CityWorld, pipe: string, failed: Set<string>): string {
  let p = world.network.pipe.get(pipe);
  for (let guard = 0; p && guard < 10000; guard++) {
    if (failed.has(p.id)) return p.id;
    if (failed.has(p.from)) return p.from;
    const up = world.network.feeds.get(p.from);
    p = up ? world.network.pipe.get(up) : undefined;
  }
  return failed.has(SOURCE_ID) ? SOURCE_ID : "unknown";
}

/** Plain names for any network element or building id. */
export function nameOf(world: CityWorld, id: string): string {
  return world.network.node.get(id)?.label ?? world.network.pipe.get(id)?.label ?? buildingById(world, id)?.name ?? id;
}

export interface Scenario { id: string; label: string; failure: Failure }
/** Ready-made failures for one level, named the way a resident would say them. */
export function scenariosFor(world: CityWorld, n: number): Scenario[] {
  const net = world.network;
  if (!net.node.has(pumpId(n))) return [];
  const list: Scenario[] = [{ id: `pump-${n}`, label: `Lift station ${n} stops`, failure: { nodes: [pumpId(n)] } }];
  // The main serving the most buildings on this level.
  const served = new Map<string, number>();
  for (const t of net.taps) if (t.level === n) {
    for (let p = net.pipe.get(t.pipe); p && p.kind === "main"; p = net.pipe.get(net.feeds.get(p.from) ?? "")) served.set(p.id, (served.get(p.id) ?? 0) + 1);
  }
  // Pick one that cuts off a sizeable part of the level, but not all of it.
  const total = net.taps.filter((t) => t.level === n).length;
  const big = [...served].sort((a, b) => Math.abs(a[1] - total * 0.4) - Math.abs(b[1] - total * 0.4))[0];
  if (big) list.push({ id: `main-${n}`, label: `${net.pipe.get(big[0])!.label} breaks`, failure: { pipes: [big[0]] } });
  const feed = net.feeds.get(riserId(n));
  if (feed && net.pipe.get(feed)!.kind === "riser") list.push({ id: `riser-${n}`, label: `Riser into L${n} breaks`, failure: { pipes: [feed] } });
  return list;
}

// --- Walking: the street graph, floods, safe routes -----------------------------------------

export interface StreetEdge { id: string; a: string; b: string; street: string; width: number }
export interface StreetGraph { pos: Map<string, XZ>; edges: StreetEdge[]; stairs: { id: string; name: string; at: XZ }[] }

const graphCache = new WeakMap<Grid, StreetGraph>();
/** Every walkable street segment between crossings (same on every level). */
export function streetGraph(grid: Grid): StreetGraph {
  const hit = graphCache.get(grid);
  if (hit) return hit;
  const ns = grid.streets.filter((s) => s.dir === "ns").sort((a, b) => a.at - b.at);
  const ew = grid.streets.filter((s) => s.dir === "ew").sort((a, b) => a.at - b.at);
  const k = (i: number, j: number) => `${i}.${j}`;
  const pos = new Map<string, XZ>();
  const zLine = [ns[0].from, ...ew.map((s) => s.at), ns[0].to];
  const xLine = [ew[0].from, ...ns.map((s) => s.at), ew[0].to];
  ns.forEach((s, i) => zLine.forEach((z, j) => pos.set(k(i + 1, j), [s.at, z])));
  ew.forEach((s, j) => { pos.set(k(0, j + 1), [xLine[0], s.at]); pos.set(k(ns.length + 1, j + 1), [xLine[xLine.length - 1], s.at]); });
  const edges: StreetEdge[] = [];
  ns.forEach((s, i) => { for (let j = 0; j < zLine.length - 1; j++) edges.push({ id: `${k(i + 1, j)}~${k(i + 1, j + 1)}`, a: k(i + 1, j), b: k(i + 1, j + 1), street: s.name, width: s.width }); });
  ew.forEach((s, j) => { for (let i = 0; i < xLine.length - 1; i++) edges.push({ id: `${k(i, j + 1)}~${k(i + 1, j + 1)}`, a: k(i, j + 1), b: k(i + 1, j + 1), street: s.name, width: s.width }); });
  // Stairwells at both ends of the central east–west street lead to the levels above and below.
  const cj = ew.findIndex((s) => s.at === 0) + 1;
  const stairs = [
    { id: k(0, cj), name: "West stairs", at: pos.get(k(0, cj))! },
    { id: k(ns.length + 1, cj), name: "East stairs", at: pos.get(k(ns.length + 1, cj))! },
  ];
  const g = { pos, edges, stairs };
  graphCache.set(grid, g);
  return g;
}

function distToSeg([px, pz]: XZ, [ax, az]: XZ, [bx, bz]: XZ): { d: number; at: XZ } {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const at: XZ = [ax + t * dx, az + t * dz];
  return { d: Math.hypot(px - at[0], pz - at[1]), at };
}
const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Street segments assumed unsafe around a flood point. An assumption: the sensor only knows its own spot. */
export function floodedEdges(grid: Grid, at: XZ, radius: number): Set<string> {
  const g = streetGraph(grid);
  return new Set(g.edges.filter((e) => distToSeg(at, g.pos.get(e.a)!, g.pos.get(e.b)!).d < radius + e.width / 2).map((e) => e.id));
}

export interface Route { points: XZ[]; meters: number; minutes: number; via: string[]; to: string; toId: string }
export interface Destination { id: string; name: string; at: XZ }

/** Shortest walk from a point to the nearest destination, avoiding blocked segments. */
export function safeRoute(grid: Grid, from: XZ, targets: Destination[], blocked: ReadonlySet<string>): Route | null {
  const g = streetGraph(grid);
  const open = g.edges.filter((e) => !blocked.has(e.id));
  const access = (p: XZ) => {
    let best: { e: StreetEdge; at: XZ; d: number } | null = null;
    for (const e of open) { const r = distToSeg(p, g.pos.get(e.a)!, g.pos.get(e.b)!); if (!best || r.d < best.d) best = { e, ...r }; }
    return best;
  };
  const start = access(from);
  if (!start) return null;
  // Dijkstra from the start's segment ends.
  const d = new Map<string, number>(), prev = new Map<string, string | null>();
  for (const id of g.pos.keys()) d.set(id, Infinity);
  for (const end of [start.e.a, start.e.b]) { d.set(end, dist(from, start.at) + dist(start.at, g.pos.get(end)!)); prev.set(end, null); }
  const adj = new Map<string, { to: string; w: number; e: StreetEdge }[]>();
  for (const e of open) {
    const w = dist(g.pos.get(e.a)!, g.pos.get(e.b)!);
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, w, e });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, w, e });
  }
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    for (const [id, v] of d) if (!done.has(id) && v < Infinity && (u === null || v < d.get(u)!)) u = id;
    if (u === null) break;
    done.add(u);
    for (const { to, w } of adj.get(u) ?? []) if (d.get(u)! + w < d.get(to)!) { d.set(to, d.get(u)! + w); prev.set(to, u); }
  }
  let best: { t: Destination; total: number; end: string; at: XZ } | null = null;
  for (const t of targets) {
    const a = access(t.at);
    if (!a) continue;
    for (const end of [a.e.a, a.e.b]) {
      const total = d.get(end)! + dist(g.pos.get(end)!, a.at) + dist(a.at, t.at);
      if (Number.isFinite(total) && (!best || total < best.total)) best = { t, total, end, at: a.at };
    }
  }
  if (!best) return null;
  const chain: string[] = [];
  for (let c: string | null | undefined = best.end; c; c = prev.get(c)) chain.unshift(c);
  const points: XZ[] = [from, start.at, ...chain.map((id) => g.pos.get(id)!), best.at, best.t.at];
  const via: string[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const e = open.find((x) => (x.a === chain[i] && x.b === chain[i + 1]) || (x.b === chain[i] && x.a === chain[i + 1]));
    if (e && via[via.length - 1] !== e.street) via.push(e.street);
  }
  return { points, meters: Math.round(best.total), minutes: Math.max(1, Math.round(best.total / 70)), via, to: best.t.name, toId: best.t.id };
}

/** Buildings with no dry street to either stairwell. */
export function cutOffBuildings(grid: Grid, level: Level, blocked: ReadonlySet<string>): Set<string> {
  const g = streetGraph(grid);
  const open = g.edges.filter((e) => !blocked.has(e.id));
  const reach = new Set(g.stairs.map((s) => s.id));
  const queue = [...reach];
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of open) {
      const v = e.a === u ? e.b : e.b === u ? e.a : null;
      if (v && !reach.has(v)) { reach.add(v); queue.push(v); }
    }
  }
  const out = new Set<string>();
  for (const b of level.buildings) {
    const near = g.edges.map((e) => ({ e, d: distToSeg(b.center, g.pos.get(e.a)!, g.pos.get(e.b)!).d })).sort((x, y) => x.d - y.d);
    const ok = near.filter((x) => x.d <= near[0].d + 14).some((x) => !blocked.has(x.e.id) && (reach.has(x.e.a) || reach.has(x.e.b)));
    if (!ok) out.add(b.id);
  }
  return out;
}

export const destinations = (level: Level, uses: BuildingUse[]): Destination[] =>
  level.buildings.filter((b) => uses.includes(b.use)).map((b) => ({ id: b.id, name: b.name.replace(`L${level.n} `, ""), at: b.center }));
