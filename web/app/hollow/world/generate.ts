// Seeded, constraint-based generator for the Hollow. Same seed + config → same world, so a
// building never moves between page loads. Plain TypeScript, no React or three.js, so it
// runs in tests (node --test) and in the browser alike.
//
// Order: levels → facilities (fixed rules) → fill buildings (seeded) → population →
// water network (reservoir → treatment → pumps → riser junctions → buildings) → sensors, hubs.

import type { Building, BuildingKind, District, Level, Pipe, Sensor, HubSite, WaterNode, World, WorldConfig } from "./types";

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 48291,
  levels: 40,
  population: 12000,
  slab: { width: 36, depth: 24 },
  grid: { cols: 9, rows: 6 },
  shaftRadius: 3.2,
};

/** Where the riser (water) and the hub link run inside the central shaft. */
export const RISER_XZ = { x: 1.6, z: 1.6 };
export const LINK_XZ = { x: -1.6, z: -1.6 };

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

// --- Levels: the vertical plan of the city (1 = top, 40 = deepest) -------------------

const NAMED: Record<number, string> = {
  1: "Surface lock", 2: "Air intakes", 3: "Upper access",
  9: "North infirmary", 12: "North relay", 13: "Lift station 3",
  17: "Market row", 22: "Works hospital", 25: "Lift station 2",
  27: "East stairwell", 31: "Lower rings", 34: "Pump room", 35: "Lift station 1",
  36: "Filtration", 38: "Deep cistern", 40: "Foundations",
};

export function districtFor(n: number): District {
  if (n <= 3) return "access";
  if (n === 12) return "relay";
  if (n <= 11) return "residential";
  if (n <= 18) return "market";
  if (n <= 25) return "works";
  if (n <= 33) return "residential";
  if (n <= 36) return "water";
  return "deep";
}

const DISTRICT_NAME: Record<District, string> = {
  access: "Access", residential: "Ring", relay: "Relay", market: "Market", works: "Works", water: "Waterworks", deep: "Deep",
};

// --- Fixed facilities (the constraints) -----------------------------------------------

interface Facility { kind: BuildingKind; name: string; capacity: number; id?: string }

const FACILITIES: Record<number, Facility[]> = {
  2: [{ kind: "air_intake", name: "Air intake A", capacity: 0 }],
  9: [{ kind: "hospital", name: "North infirmary", capacity: 120, id: "hospital-09" }],
  12: [{ kind: "relay", name: "North relay (hub L12)", capacity: 0, id: "relay-12" }],
  13: [{ kind: "pump_station", name: "Lift station 3", capacity: 0, id: "pump-p3" }],
  22: [{ kind: "hospital", name: "Works hospital", capacity: 220, id: "hospital-22" }],
  25: [{ kind: "pump_station", name: "Lift station 2", capacity: 0, id: "pump-p2" }],
  34: [
    { kind: "pump_room", name: "Pump room (hub L34)", capacity: 0, id: "pumproom-34" },
    { kind: "hospital", name: "Deep infirmary", capacity: 90, id: "hospital-34" },
  ],
  35: [{ kind: "pump_station", name: "Lift station 1", capacity: 0, id: "pump-p1" }],
  36: [{ kind: "treatment", name: "Filtration plant", capacity: 0, id: "treatment-36" }],
  38: [{ kind: "reservoir", name: "Deep cistern", capacity: 0, id: "reservoir-38" }],
};
const SHELTER_LEVELS = [5, 10, 15, 19, 27, 30, 33, 37];

const INFRA: BuildingKind[] = ["pump_room", "pump_station", "treatment", "reservoir", "relay", "air_intake"];
export const isInfrastructure = (k: BuildingKind) => INFRA.includes(k);

/** How full each district is, and what fills it. */
const FILL: Record<District, { density: number; kinds: [BuildingKind, number][] }> = {
  access: { density: 0.35, kinds: [["workshop", 1]] },
  residential: { density: 0.78, kinds: [["residential", 0.85], ["market", 0.15]] },
  relay: { density: 0.55, kinds: [["residential", 0.6], ["workshop", 0.4]] },
  market: { density: 0.7, kinds: [["market", 0.55], ["residential", 0.45]] },
  works: { density: 0.6, kinds: [["workshop", 0.7], ["residential", 0.3]] },
  water: { density: 0.45, kinds: [["workshop", 0.5], ["residential", 0.5]] },
  deep: { density: 0.25, kinds: [["workshop", 1]] },
};

const HEIGHT: Record<BuildingKind, [number, number]> = {
  residential: [0.7, 1.6], shelter: [0.9, 1.2], hospital: [1.3, 1.6], market: [0.4, 0.7], workshop: [0.5, 1.0],
  relay: [1.2, 1.2], pump_room: [0.9, 0.9], pump_station: [1.0, 1.0], treatment: [0.8, 0.8], reservoir: [0.5, 0.5],
  air_intake: [1.4, 1.4],
};

const KIND_LABEL: Record<BuildingKind, string> = {
  residential: "Housing block", shelter: "Shelter", hospital: "Hospital", market: "Market hall", workshop: "Workshop",
  relay: "Relay", pump_room: "Pump room", pump_station: "Lift station", treatment: "Treatment", reservoir: "Reservoir",
  air_intake: "Air intake",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function generateWorld(config: WorldConfig = DEFAULT_CONFIG): World {
  const rand = mulberry32(config.seed);
  const pick = <T,>(weights: [T, number][]): T => {
    let r = rand() * weights.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of weights) if ((r -= w) <= 0) return v;
    return weights[weights.length - 1][0];
  };

  const { cols, rows } = config.grid;
  const cw = config.slab.width / cols;
  const cd = config.slab.depth / rows;
  const cellCenter = (c: number, r: number) => ({
    x: -config.slab.width / 2 + cw * (c + 0.5),
    z: -config.slab.depth / 2 + cd * (r + 0.5),
  });
  // Cells, nearest the shaft first. Cells too close to the shaft stay open (the ring walkway).
  const cells: [number, number][] = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const { x, z } = cellCenter(c, r);
      if (Math.hypot(x, z) >= config.shaftRadius + 1.8) cells.push([c, r]);
    }
  cells.sort((a, b) => {
    const pa = cellCenter(...a), pb = cellCenter(...b);
    return Math.hypot(pa.x, pa.z) - Math.hypot(pb.x, pb.z) || a[0] - b[0] || a[1] - b[1];
  });

  const levels: Level[] = [];
  const buildings: Building[] = [];

  for (let n = 1; n <= config.levels; n++) {
    const district = districtFor(n);
    levels.push({ n, name: NAMED[n] ?? `${DISTRICT_NAME[district]} ${n}`, district, population: 0 });

    const free = [...cells];
    const take = (nearShaft: boolean) => {
      const i = nearShaft ? 0 : Math.floor(rand() * free.length);
      return free.splice(i, 1)[0];
    };
    const place = (kind: BuildingKind, name: string, capacity: number, cell: [number, number], id?: string) => {
      const { x, z } = cellCenter(...cell);
      const [h0, h1] = HEIGHT[kind];
      const big = kind === "hospital" || kind === "reservoir" || kind === "treatment";
      const w = cw * (big ? 0.86 : 0.5 + rand() * 0.32);
      const d = cd * (big ? 0.86 : 0.5 + rand() * 0.32);
      const idx = buildings.filter((b) => b.level === n).length + 1;
      buildings.push({
        id: id ?? `L${pad(n)}-${kind}-${pad(idx)}`,
        kind, name, level: n, cell, x, z, w, d,
        h: h0 + rand() * (h1 - h0),
        capacity, population: 0,
      });
    };

    for (const f of FACILITIES[n] ?? []) place(f.kind, f.name, f.capacity, take(true), f.id);
    if (SHELTER_LEVELS.includes(n)) place("shelter", `Shelter ${SHELTER_LEVELS.indexOf(n) + 1}`, 150, take(true), `shelter-${pad(n)}`);

    const { density, kinds } = FILL[district];
    const count = Math.max(1, Math.round(free.length * density * (0.85 + rand() * 0.3)));
    for (let i = 0; i < count && free.length; i++) {
      const kind = pick(kinds);
      place(kind, `${KIND_LABEL[kind]} ${n}-${String.fromCharCode(65 + i)}`, kind === "residential" ? 0 : 0, take(false));
    }
  }

  // Population: residential blocks by volume, plus a small share in shelters. Sums exactly.
  const homes = buildings.filter((b) => b.kind === "residential" || b.kind === "shelter");
  const weight = (b: Building) => b.w * b.d * b.h * (b.kind === "shelter" ? 0.4 : 1);
  const total = homes.reduce((s, b) => s + weight(b), 0);
  let assigned = 0;
  homes.forEach((b, i) => {
    b.population = i === homes.length - 1 ? config.population - assigned : Math.round((weight(b) / total) * config.population);
    assigned += b.population;
    if (b.kind === "residential") b.capacity = Math.round(b.population * 1.15);
  });
  for (const l of levels) l.population = buildings.filter((b) => b.level === l.n).reduce((s, b) => s + b.population, 0);

  // --- Water: a directed graph. Water comes from the deep cistern, is treated, and is
  // lifted up the shaft by three lift stations; gravity feeds the levels below the plant.
  const nodes: WaterNode[] = [];
  const pipes: Pipe[] = [];
  const at = (level: number) => ({ level, ...RISER_XZ });
  const node = (id: string, kind: WaterNode["kind"], level: number, name: string, buildingId?: string) =>
    nodes.push({ id, kind, name, buildingId, ...at(level) });
  const pipe = (from: string, to: string, kind: Pipe["kind"]) => pipes.push({ id: `${from}>${to}`, kind, from, to });

  node("R-38", "reservoir", 38, "Deep cistern", "reservoir-38");
  node("T-36", "treatment", 36, "Filtration plant", "treatment-36");
  node("P-1", "pump", 35, "Lift station 1", "pump-p1");
  node("P-2", "pump", 25, "Lift station 2", "pump-p2");
  node("P-3", "pump", 13, "Lift station 3", "pump-p3");
  for (let n = 1; n <= config.levels; n++) node(`J-${n}`, "junction", n, `Riser junction L${n}`);

  pipe("R-38", "T-36", "main");
  // Gravity main: plant → the levels below it.
  pipe("T-36", "J-36", "riser");
  for (let n = 36; n < config.levels; n++) pipe(`J-${n}`, `J-${n + 1}`, "riser");
  // Lift 1: plant → L35 … L26
  pipe("T-36", "P-1", "main");
  pipe("P-1", "J-35", "riser");
  for (let n = 35; n > 26; n--) pipe(`J-${n}`, `J-${n - 1}`, "riser");
  // Lift 2: L26 → L25 … L14
  pipe("J-26", "P-2", "riser");
  pipe("P-2", "J-25", "riser");
  for (let n = 25; n > 14; n--) pipe(`J-${n}`, `J-${n - 1}`, "riser");
  // Lift 3: L14 → L13 … L1
  pipe("J-14", "P-3", "riser");
  pipe("P-3", "J-13", "riser");
  for (let n = 13; n > 1; n--) pipe(`J-${n}`, `J-${n - 1}`, "riser");

  for (const b of buildings) {
    if (isInfrastructure(b.kind)) continue;
    nodes.push({ id: b.id, kind: "consumer", level: b.level, name: b.name, buildingId: b.id, x: b.x, z: b.z });
    pipe(`J-${b.level}`, b.id, "branch");
  }

  const pumpRoom = buildings.find((b) => b.id === "pumproom-34")!;
  const sensors: Sensor[] = [
    { deviceId: "canary-34", level: 34, buildingId: pumpRoom.id, x: pumpRoom.x, z: pumpRoom.z, measures: ["water", "sos"], hardware: true },
  ];
  const hubs: HubSite[] = [
    { hubId: "hub-L34", level: 34, ...LINK_XZ },
    { hubId: "hub-L12", level: 12, ...LINK_XZ },
  ];

  return { config, levels, buildings, water: { nodes, pipes }, sensors, hubs };
}
