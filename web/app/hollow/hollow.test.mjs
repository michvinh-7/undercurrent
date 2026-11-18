// Run: node --test web/app/hollow/   (Node 23.6+ runs the .ts modules directly; no deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, DEFAULT_CONFIG } from "./world/generate.ts";
import { validateWorld } from "./world/validate.ts";
import { solveWater, traceDownstream, SCENARIOS } from "./sim/water.ts";

const world = generateWorld();

test("same seed, same world; new seed, new layout", () => {
  assert.deepEqual(generateWorld(), world);
  const other = generateWorld({ ...DEFAULT_CONFIG, seed: 7 });
  assert.notDeepEqual(other.buildings.map((b) => b.cell), world.buildings.map((b) => b.cell));
});

test("the demo world passes every check", () => {
  const failed = validateWorld(world).filter((c) => !c.pass);
  assert.deepEqual(failed, []);
});

test("other seeds pass too", () => {
  for (const seed of [1, 2, 3, 99, 2026]) {
    const failed = validateWorld(generateWorld({ ...DEFAULT_CONFIG, seed })).filter((c) => !c.pass);
    assert.deepEqual(failed, [], `seed ${seed}`);
  }
});

test("with nothing failed, every consumer has water", () => {
  const s = solveWater(world);
  assert.equal(s.cutOff.size, 0);
  for (const n of world.water.nodes) assert.ok(s.supplied.has(n.id), n.id);
});

test("P-2 failing cuts off exactly L1–L25, and blames P-2", () => {
  const s = solveWater(world, { nodes: ["P-2"] });
  const levels = new Set([...s.cutOff.keys()].map((id) => world.water.nodes.find((n) => n.id === id).level));
  assert.deepEqual([...levels].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.ok([...s.cutOff.values()].every((c) => c === "P-2"));
  assert.ok(s.cutOff.has("hospital-22") && s.cutOff.has("hospital-09") && !s.cutOff.has("hospital-34"));
});

test("a rupture at L18 cuts off L1–L17 and names the pipe", () => {
  const s = solveWater(world, { pipes: ["J-18>J-17"] });
  const levels = new Set([...s.cutOff.keys()].map((id) => world.water.nodes.find((n) => n.id === id).level));
  assert.equal(Math.max(...levels), 17);
  assert.equal(Math.min(...levels), 1);
  assert.ok([...s.cutOff.values()].every((c) => c === "J-18>J-17"));
});

test("filtration offline: nothing downstream has water", () => {
  const s = solveWater(world, { nodes: ["T-36"] });
  assert.equal(s.cutOff.size, world.water.nodes.filter((n) => n.kind === "consumer").length);
});

test("a tracer at P-3 only reaches L1–L13, in flow order", () => {
  const hops = traceDownstream(world, "P-3", solveWater(world));
  const levels = [...hops.keys()].map((id) => world.water.nodes.find((n) => n.id === id).level);
  assert.ok(levels.every((l) => l <= 13));
  assert.ok(hops.get("J-13") < hops.get("J-1"));
});

test("every scenario names elements that exist", () => {
  const ids = new Set([...world.water.nodes.map((n) => n.id), ...world.water.pipes.map((p) => p.id)]);
  for (const s of SCENARIOS) for (const id of [...(s.failure?.nodes ?? []), ...(s.failure?.pipes ?? []), s.contaminate].filter(Boolean)) assert.ok(ids.has(id), `${s.id}: ${id}`);
});
