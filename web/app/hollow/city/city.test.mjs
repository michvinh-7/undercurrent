// Run from web/: node --test app/hollow/   (Node 23.6+ loads the .ts files directly; no deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, addLevel, solveWater, scenariosFor, insideOutline, pumpId, riserId, INITIAL_LEVELS } from "./model.ts";
import { adaptEvent, adaptEvents, summarize } from "./adapter.ts";
import { streetGraph, floodedEdges, safeRoute, cutOffBuildings, destinations, CORE } from "./model.ts";
import { narrate } from "./narrate.ts";
import { matchPlace, isWaterReport, isLungReport } from "./adapter.ts";
import { streetMain, levelInlet, upstream, traceSource, pumpId as pid } from "./model.ts";

const world = createWorld();
const opts = { isVerified: (e) => !!e.sig, demo: false };
const ev = (over = {}) => ({
  id: "e1", type: "hazard", hub_id: "hub-L34", level: 34, created_at: "2026-11-18T10:00:00Z", author: "a",
  priority: null, payload: { kind: "flooding", severity: "high" }, prev_hash: "", hash: "", ...over,
});

test("starts with exactly L12, L34, L35", () => {
  assert.deepEqual(world.levels.map((l) => l.n), [...INITIAL_LEVELS].sort((a, b) => a - b));
});

test("same seed → same world", () => {
  assert.deepEqual(JSON.stringify(createWorld().levels), JSON.stringify(world.levels));
});

test("every building sits inside the cavern, with unique ids, and none overlap", () => {
  const ids = new Set();
  for (const l of world.levels) {
    const boxes = [];
    for (const b of l.buildings) {
      assert.ok(!ids.has(b.id), b.id); ids.add(b.id);
      for (const p of b.footprint.outer) assert.ok(insideOutline(p), `${b.id} outside`);
      const xs = b.footprint.outer.map((p) => p[0]), zs = b.footprint.outer.map((p) => p[1]);
      boxes.push([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), b.id]);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `${a[4]} overlaps ${b[4]}`);
    }
  }
});

test("footprints vary (not all boxes)", () => {
  const shapes = new Set(world.levels.flatMap((l) => l.buildings.map((b) => `${b.footprint.outer.length}/${b.footprint.holes.length}`)));
  assert.ok(shapes.size >= 3, [...shapes].join(","));
});

test("all three levels share the same streets and shafts", () => {
  assert.ok(world.network.nodes.filter((n) => n.kind === "riser").every((n) => n.x === world.network.node.get(riserId(34)).x));
  const j = (n) => world.network.nodes.filter((x) => x.level === n && x.kind === "junction").map((x) => `${x.x},${x.z}`).sort();
  assert.deepEqual(j(12), j(34));
});

test("nothing failed → every building has water", () => {
  assert.equal(solveWater(world).dry.size, 0);
  assert.equal(world.network.taps.length, world.levels.flatMap((l) => l.buildings).filter((b) => b.use !== "pumphouse").length);
});

test("L34 lift station stops → all of L34 dry, L12 and L35 still fed (riser bypasses the pump)", () => {
  const s = solveWater(world, { nodes: [pumpId(34)] });
  const levels = new Set([...s.dry.keys()].map((id) => id.split("/")[0]));
  assert.deepEqual([...levels], ["L34"]);
  assert.ok([...s.dry.values()].every((c) => c === pumpId(34)));
});

test("riser into L34 breaks → L34 and L12 dry, L35 fed", () => {
  const into34 = world.network.feeds.get(riserId(34));
  const s = solveWater(world, { pipes: [into34] });
  const levels = new Set([...s.dry.keys()].map((id) => id.split("/")[0]));
  assert.deepEqual([...levels].sort(), ["L12", "L34"]);
});

test("a broken main dries only its own downstream buildings on that level", () => {
  const sc = scenariosFor(world, 34).find((x) => x.id === "main-34");
  const s = solveWater(world, sc.failure);
  const all = world.levels.find((l) => l.n === 34).buildings.length - 1;
  assert.ok(s.dry.size > 0 && s.dry.size < all, `${s.dry.size} of ${all}`);
  assert.ok([...s.dry.keys()].every((id) => id.startsWith("L34/")));
});

test("adding a level keeps existing levels identical and rebuilds the network", () => {
  const before = JSON.stringify(world.levels);
  const w2 = addLevel(world, 36);
  assert.deepEqual(w2.levels.map((l) => l.n), [12, 34, 35, 36]);
  assert.equal(JSON.stringify(w2.levels.filter((l) => l.n !== 36)), before);
  assert.ok(w2.levels.filter((l) => l.n !== 36).every((l, i) => l === world.levels[i]), "same objects, not regenerated");
  assert.ok(w2.network.node.has(pumpId(36)));
  assert.equal(solveWater(w2).dry.size, 0, "new level is connected");
  // L36 is fed from L35 via the riser
  assert.equal(w2.network.pipe.get(w2.network.feeds.get(riserId(36))).from, riserId(35));
});

test("adding the same level twice does nothing; bad levels are refused", () => {
  const w2 = addLevel(world, 36);
  assert.equal(addLevel(w2, 36), w2);
  assert.throws(() => addLevel(world, 0));
  assert.throws(() => addLevel(world, 2.5));
});

test("adapter: a sensor hazard from canary-34 gets its exact mount", () => {
  const m = adaptEvent(ev({ source: "sensor", device_id: "canary-34", sig: "x" }), world, opts);
  assert.equal(m.place.kind, "exact");
  assert.equal(m.severity, "hazard");
  assert.equal(m.verified, true);
  assert.equal(m.origin, "sensor");
});

test("adapter: an SOS with only a level is level-only, never given coordinates", () => {
  const m = adaptEvent(ev({ id: "s", type: "checkin", payload: { status: "need_help" } }), world, opts);
  assert.equal(m.severity, "sos");
  assert.deepEqual(m.place, { kind: "level" });
  assert.equal(m.verified, false);
});

test("adapter: a device on the wrong level, or an unknown device, is not pinned", () => {
  assert.equal(adaptEvent(ev({ level: 12, device_id: "canary-34" }), world, opts).place.kind, "level");
  assert.equal(adaptEvent(ev({ device_id: "canary-99" }), world, opts).place.kind, "level");
});

test("adapter: unknown or off-map levels are handled", () => {
  const a = adaptEvent(ev({ level: undefined }), world, opts);
  assert.equal(a.place.kind, "unknown");
  assert.equal(a.level, null);
  const b = adaptEvent(ev({ level: 27 }), world, opts);
  assert.equal(b.onMap, false);
  assert.equal(b.place.kind, "level");
});

test("adapter: malformed input doesn't throw", () => {
  const out = adaptEvents([null, 5, "x", {}, { id: "" }, ev({ payload: null }), ev({ id: "e2", created_at: "nope" })], world, { ...opts, isVerified: () => { throw new Error("boom"); } });
  assert.deepEqual(out.map((m) => m.id).sort(), ["e1", "e2"]);
});

test("adapter: the same event twice → one entry; newest first; no events → empty", () => {
  const out = adaptEvents([ev(), ev(), ev({ id: "e0", created_at: "2026-11-18T09:00:00Z" })], world, opts);
  assert.deepEqual(out.map((m) => m.id), ["e1", "e0"]);
  assert.deepEqual(adaptEvents([], world, opts), []);
  assert.equal(summarize([], 34).total, 0);
});

test("adding a level doesn't change event placement for existing levels", () => {
  const events = [ev({ source: "sensor", device_id: "canary-34" }), ev({ id: "x", level: 12 })];
  const a = adaptEvents(events, world, opts), b = adaptEvents(events, addLevel(world, 36), opts);
  assert.deepEqual(b.map((m) => [m.id, m.level, m.place]), a.map((m) => [m.id, m.level, m.place]));
});

const L34 = world.levels.find((l) => l.n === 34);
const flood = [CORE.pump[0] - 2.4, CORE.pump[1] - 3.2];

test("streets: one graph for every level, with two stairwells", () => {
  const g = streetGraph(world.grid);
  assert.ok(g.edges.length > 20);
  assert.equal(g.stairs.length, 2);
  for (const e of g.edges) assert.ok(g.pos.has(e.a) && g.pos.has(e.b), e.id);
});

test("a flood at the lift station blocks nearby segments only", () => {
  const b = floodedEdges(world.grid, flood, 16);
  assert.ok(b.size >= 1 && b.size <= 6, `${b.size}`);
});

test("safe route never uses a blocked segment and reaches the hospital", () => {
  const blocked = floodedEdges(world.grid, flood, 16);
  const r = safeRoute(world.grid, flood, destinations(L34, ["hospital"]), blocked);
  assert.ok(r && r.to === "Hospital" && r.minutes >= 1);
  const g = streetGraph(world.grid);
  const pts = r.points.slice(2, -2).map((p) => p.join());
  for (let i = 0; i + 1 < pts.length; i++) {
    const e = g.edges.find((x) => [g.pos.get(x.a).join(), g.pos.get(x.b).join()].sort().join("|") === [pts[i], pts[i + 1]].sort().join("|"));
    assert.ok(e && !blocked.has(e.id), "route walks a blocked street");
  }
});

test("a small flood cuts off only the lift station standing in it; a rising one cuts off more", () => {
  assert.deepEqual([...cutOffBuildings(world.grid, L34, floodedEdges(world.grid, flood, 16))], ["L34/pump"]);
  assert.ok(cutOffBuildings(world.grid, L34, floodedEdges(world.grid, flood, 70)).size > 0);
});

test("narrator: calm, flood, link cut, simulation, forgery — and never claims more than it's given", () => {
  const base = { level: 34, levelName: "Pump room", buildings: 68, flood: null, sim: null, link: { other: 12, cut: false, queued: 0, online: true }, forgery: null, sosHere: 0, reportsHere: 0, reportsElsewhere: null, demo: false };
  assert.equal(narrate(base).tone, "calm");
  const f = narrate({ ...base, flood: { where: "the L34 lift station", ago: "2 min ago", verified: false, demo: false, blockedStreets: ["Central Way"], cutOff: 0, spread: false, route: { to: "Hospital", minutes: 3, via: ["Pumpwell St"] } } });
  assert.equal(f.tone, "alert");
  assert.match(f.source, /not verified/);
  assert.match(f.source, /assumed/);
  assert.match(narrate({ ...base, link: { other: 12, cut: true, queued: 2, online: true } }).lines[0], /2 reports are waiting/);
  assert.match(narrate({ ...base, sim: { label: "Lift station 34 stops", dry: 68, people: 557, levels: [34], facilities: [] } }).source, /Simulated/);
  assert.equal(narrate({ ...base, forgery: "unknown key" }).tone, "alert");
});

test("location text: a street or a named facility, never a near-miss", () => {
  assert.equal(matchPlace("Pumpwell St", world, 34).street, "Pumpwell St");
  assert.equal(matchPlace("pumpwell street, near the school", world, 34).street, "Pumpwell St");
  assert.equal(matchPlace("by the Hospital", world, 34).building, world.levels.find((l) => l.n === 34).buildings.find((b) => b.use === "hospital").id);
  assert.equal(matchPlace("North relay corridor", world, 12), null, "'North' alone isn't North Gallery");
  assert.equal(matchPlace("Pump room", world, 34), null);
  assert.equal(matchPlace(42, world, 34), null);
});

test("adapter: a report naming a street is placed there; the same text with no match stays level-only", () => {
  assert.equal(adaptEvent(ev({ payload: { kind: "bad_water", severity: "low", location: "Pumpwell St" } }), world, opts).place.kind, "named");
  assert.equal(adaptEvent(ev({ payload: { kind: "bad_water", severity: "low", location: "somewhere wet" } }), world, opts).place.kind, "level");
});

test("bad water: reports on one street trace to that street's main; spread-out reports trace to the lift station", () => {
  const main = streetMain(world, 34, "Pumpwell St");
  const t = traceSource(world, [upstream(world, main), upstream(world, main)]);
  assert.equal(t.source, main);
  assert.ok(t.atRisk.size > 0 && [...t.atRisk].every((id) => id.startsWith("L34/")));
  const levelOnly = [pid(34), ...upstream(world, levelInlet(world, 34))];
  assert.equal(traceSource(world, [upstream(world, main), levelOnly]).source, pid(34));
  assert.equal(traceSource(world, [upstream(world, main)]), null, "one report is not enough");
});

test("classifiers: stomach → water, cough → lungs", () => {
  const m = (payload, type = "case") => adaptEvent(ev({ type, payload }), world, opts);
  assert.ok(isWaterReport(m({ symptoms: ["Vomiting"] })));
  assert.ok(isWaterReport(m({ kind: "bad_water", severity: "low" }, "hazard")));
  assert.ok(isLungReport(m({ symptoms: ["coughing", "fever"] })));
  assert.ok(!isLungReport(m({ symptoms: ["rash"] })));
});
