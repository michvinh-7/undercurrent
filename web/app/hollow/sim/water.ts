// SIMULATED water network state. A simplified directed-graph model in the spirit of EPA
// EPANET's vocabulary (reservoir, treatment, pumps, junctions, pipes, consumers), not a
// hydraulic solver: no pressure, friction or pump curves. Water is "supplied" at a node if
// an unbroken path of working pipes and nodes reaches it from a reservoir.
//
// Nothing here ever reads a real sensor. Real events and simulated state stay separate;
// the UI labels everything from this file as SIMULATED.

import type { World } from "../world/types";

export interface Failure {
  nodes?: string[]; // e.g. a pump or the treatment plant
  pipes?: string[]; // a rupture
}

export interface WaterState {
  supplied: Set<string>; // node ids with water
  flowing: Set<string>; // pipe ids carrying water
  failedNodes: Set<string>;
  failedPipes: Set<string>;
  /** Consumers that lost water, with the failure that cut them off. */
  cutOff: Map<string, string>;
}

function graph(world: World) {
  const out = new Map<string, { pipe: string; to: string }[]>();
  for (const p of world.water.pipes) out.set(p.from, [...(out.get(p.from) ?? []), { pipe: p.id, to: p.to }]);
  return out;
}

function bfs(world: World, failedNodes: Set<string>, failedPipes: Set<string>) {
  const out = graph(world);
  const sources = world.water.nodes.filter((n) => n.kind === "reservoir" && !failedNodes.has(n.id)).map((n) => n.id);
  const seen = new Set(sources);
  const parent = new Map<string, { node: string; pipe: string }>();
  const flowing = new Set<string>();
  const queue = [...sources];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { pipe, to } of out.get(id) ?? []) {
      if (failedPipes.has(pipe) || failedNodes.has(to)) continue;
      flowing.add(pipe);
      if (!seen.has(to)) {
        seen.add(to);
        parent.set(to, { node: id, pipe });
        queue.push(to);
      }
    }
  }
  return { seen, parent, flowing };
}

export function solveWater(world: World, failure: Failure = {}): WaterState {
  const failedNodes = new Set(failure.nodes ?? []);
  const failedPipes = new Set(failure.pipes ?? []);
  const now = bfs(world, failedNodes, failedPipes);
  const base = bfs(world, new Set(), new Set());

  // For each consumer that had water and lost it, walk its normal supply path back
  // toward the source and name the first failed element on it.
  const cutOff = new Map<string, string>();
  for (const n of world.water.nodes) {
    if (n.kind !== "consumer" || now.seen.has(n.id) || !base.seen.has(n.id)) continue;
    let at = n.id;
    let cause = "unknown";
    while (base.parent.has(at)) {
      const { node, pipe } = base.parent.get(at)!;
      if (failedPipes.has(pipe)) cause = pipe;
      if (failedNodes.has(at)) cause = at;
      at = node;
    }
    if (failedNodes.has(at)) cause = at;
    cutOff.set(n.id, cause);
  }
  return { supplied: now.seen, flowing: now.flowing, failedNodes, failedPipes, cutOff };
}

/**
 * SIMULATED tracer: a contaminant entering at `start`, carried downstream by flow.
 * Returns hops from the entry point for every reached node, so the UI can animate the
 * front moving through the network (one hop ≈ one step of accelerated time). In this tree
 * network no two flows merge, so the concentration isn't diluted at junctions; a network
 * with loops would need the flow-weighted mixing rule C = Σ(QᵢCᵢ)/ΣQᵢ.
 */
export function traceDownstream(world: World, start: string, state: WaterState): Map<string, number> {
  const out = graph(world);
  const hops = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { pipe, to } of out.get(id) ?? []) {
      if (!state.flowing.has(pipe) || hops.has(to)) continue;
      hops.set(to, hops.get(id)! + 1);
      queue.push(to);
    }
  }
  return hops;
}

export interface Scenario {
  id: string;
  title: string;
  detail: string;
  failure?: Failure;
  contaminate?: string;
}

export const SCENARIOS: Scenario[] = [
  { id: "pump-p2", title: "Lift station 2 fails", detail: "Pump P-2 on L25 stops. Everything it lifts loses supply.", failure: { nodes: ["P-2"] } },
  { id: "pump-p1", title: "Lift station 1 fails", detail: "Pump P-1 on L35 stops: the first lift out of the plant.", failure: { nodes: ["P-1"] } },
  { id: "rupture-18", title: "Riser ruptures at L18", detail: "The riser between L18 and L17 breaks.", failure: { pipes: ["J-18>J-17"] } },
  { id: "treatment", title: "Filtration plant offline", detail: "T-36 stops. No treated water anywhere.", failure: { nodes: ["T-36"] } },
  { id: "contaminate-p3", title: "Contaminant enters at Lift 3", detail: "A tracer enters at P-3 (L13) and moves with the flow.", contaminate: "P-3" },
];
