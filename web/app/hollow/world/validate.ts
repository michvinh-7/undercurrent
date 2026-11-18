// Rules a generated world must pass before the map uses it. A world isn't "done" because
// it renders: every home needs treated water, every hospital needs supply, no pipe may
// dangle, and the population must add up. Shown in the UI as the "World check".

import type { Check, World } from "./types";

export function validateWorld(w: World): Check[] {
  const checks: Check[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });

  const ids = [...w.buildings.map((b) => b.id), ...w.water.nodes.filter((n) => n.kind !== "consumer").map((n) => n.id)];
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  add("unique-ids", "Every object has a unique id", dupes.length === 0, dupes.length ? `duplicates: ${dupes.slice(0, 3).join(", ")}` : `${ids.length} ids`);

  const { width, depth } = w.config.slab;
  const outside = w.buildings.filter(
    (b) =>
      Math.abs(b.x) + b.w / 2 > width / 2 ||
      Math.abs(b.z) + b.d / 2 > depth / 2 ||
      Math.hypot(b.x, b.z) < w.config.shaftRadius + 1,
  );
  add("bounds", "Buildings sit on the slab, clear of the shaft", outside.length === 0, outside.length ? `${outside.length} out of bounds` : `${w.buildings.length} buildings`);

  const cellKeys = w.buildings.map((b) => `${b.level}:${b.cell.join(",")}`);
  const overlaps = cellKeys.length - new Set(cellKeys).size;
  add("no-overlap", "No two buildings share a cell", overlaps === 0, overlaps ? `${overlaps} overlaps` : "one building per cell");

  const levelsMissing = w.levels.filter((l) => !w.buildings.some((b) => b.level === l.n)).map((l) => l.n);
  add("levels-built", `All ${w.levels.length} levels have buildings`, levelsMissing.length === 0, levelsMissing.length ? `empty: L${levelsMissing.join(", L")}` : "none empty");

  const nodeIds = new Set(w.water.nodes.map((n) => n.id));
  const dangling = w.water.pipes.filter((p) => !nodeIds.has(p.from) || !nodeIds.has(p.to));
  add("pipes-connected", "Every pipe connects two real nodes", dangling.length === 0, dangling.length ? `${dangling.length} dangling` : `${w.water.pipes.length} pipes`);

  const junctionLevels = new Set(w.water.nodes.filter((n) => n.kind === "junction").map((n) => n.level));
  const noJunction = w.levels.filter((l) => !junctionLevels.has(l.n)).map((l) => l.n);
  add("junction-per-level", "Every level has a riser junction", noJunction.length === 0, noJunction.length ? `missing: ${noJunction.join(", ")}` : "40 of 40");

  // Reachability over the directed water graph.
  const out = new Map<string, string[]>();
  for (const p of w.water.pipes) out.set(p.from, [...(out.get(p.from) ?? []), p.to]);
  const reach = (starts: string[], skip = new Set<string>()) => {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of out.get(id) ?? []) if (!seen.has(next) && !skip.has(next)) (seen.add(next), queue.push(next));
    }
    return seen;
  };
  const sources = w.water.nodes.filter((n) => n.kind === "reservoir").map((n) => n.id);
  const supplied = reach(sources);
  const consumers = w.water.nodes.filter((n) => n.kind === "consumer");
  const dry = consumers.filter((c) => !supplied.has(c.id));
  add("water-reaches-all", "Every occupied building has a water route", dry.length === 0, dry.length ? `${dry.length} without supply` : `${consumers.length} of ${consumers.length}`);

  const treatment = w.water.nodes.filter((n) => n.kind === "treatment").map((n) => n.id);
  const untreated = reach(sources, new Set(treatment));
  const raw = consumers.filter((c) => untreated.has(c.id));
  add("water-treated", "All drinking water passes treatment", raw.length === 0 && treatment.length > 0, raw.length ? `${raw.length} bypass treatment` : `via ${treatment.join(", ")}`);

  const hospitals = w.buildings.filter((b) => b.kind === "hospital");
  const dryHospitals = hospitals.filter((h) => !supplied.has(h.id));
  add("hospitals-supplied", "Every hospital is on the water network", hospitals.length > 0 && dryHospitals.length === 0, `${hospitals.length - dryHospitals.length} of ${hospitals.length}`);

  const badSensors = w.sensors.filter((s) => !w.buildings.some((b) => b.id === s.buildingId && b.level === s.level));
  add("sensors-placed", "Every sensor is mounted in a real building", badSensors.length === 0, `${w.sensors.length} sensor(s)`);

  const hubLevels = w.hubs.map((h) => h.level);
  add("hubs", "Both hubs are placed (L34, L12)", hubLevels.includes(34) && hubLevels.includes(12), w.hubs.map((h) => h.hubId).join(", "));

  const pop = w.buildings.reduce((s, b) => s + b.population, 0);
  add("population", "Population adds up", pop === w.config.population, `${pop.toLocaleString()} of ${w.config.population.toLocaleString()}`);

  return checks;
}
