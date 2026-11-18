// Geometry built once per Level object and cached. Adding a level reuses the cached
// geometry of the others; status changes only rewrite vertex colors, never geometry.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Building, BuildingUse, Grid, Level, XZ } from "../model";
import { CITY, PLAZA_RADIUS } from "../model";

/** Calm map palette. Most of the city stays neutral; color is reserved for status. */
export const P = {
  sky: "#e8e5df",
  street: "#cfcac0",
  paving: "#e6e1d6",
  plaza: "#ece6d9",
  park: "#b9c7a5",
  yard: "#d8cfbd",
  cavern: "#aaa294",
  wall: "#f3efe6",
  roof: "#949ba5",
  pipe: "#9ba3ad",
  water: "#3b82c4",
  waterSurface: "#4f8fc0",
  dryWall: "#efd29c",
  dryRoof: "#c98f2e",
  failed: "#c2412d",
  select: "#4f5fb3",
  ok: "#2f7f6f",
  ghost: "#8b8577",
  flood: "#5f7f93",
  route: "#1f8a70",
  cutWall: "#c9c4bb",
  cutRoof: "#7d7a74",
};

const ROOF: Partial<Record<BuildingUse, string>> = {
  hospital: "#b07a70", clinic: "#b07a70", shelter: "#7f9b88", school: "#a8966f",
  market: "#8e93a0", relay: "#6f88a6", pumphouse: "#6a8fa6",
};
export const roofColor = (u: BuildingUse) => ROOF[u] ?? P.roof;

export function shapeOf(outer: XZ[], holes: XZ[][] = []): THREE.Shape {
  // Shape space is (x, -z); rotating -90° about X maps it back onto the ground.
  const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  return s;
}

function flat(polys: XZ[][], y: number, depth = 0): THREE.BufferGeometry | null {
  if (!polys.length) return null;
  const geos = polys.map((p) => {
    const g = depth > 0 ? new THREE.ExtrudeGeometry(shapeOf(p), { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shapeOf(p));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return depth > 0 ? g.toNonIndexed() : g;
  });
  const out = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return out;
}

export interface BuildingMesh {
  geometry: THREE.BufferGeometry;
  /** Vertex range per building, in order, for picking and recoloring. */
  ranges: { id: string; start: number; count: number }[];
  base: Float32Array;
  /** Which vertices are roof (true) vs wall. */
  roof: Uint8Array;
}

export interface LevelGeometry {
  buildings: BuildingMesh;
  paving: THREE.BufferGeometry | null;
  parks: THREE.BufferGeometry | null;
  yards: THREE.BufferGeometry | null;
  outlineLine: THREE.BufferGeometry;
}

const cache = new WeakMap<Level, LevelGeometry>();
const gridCache = new WeakMap<Grid, { floor: THREE.BufferGeometry; wall: THREE.BufferGeometry; plaza: THREE.BufferGeometry }>();

export function gridGeometry(grid: Grid) {
  let g = gridCache.get(grid);
  if (g) return g;
  const floor = new THREE.ShapeGeometry(shapeOf(grid.outline));
  floor.rotateX(-Math.PI / 2);
  // The cavern wall: a low rim just outside the outline.
  const outer = grid.outline.map(([x, z]) => [x * (1 + 10 / CITY.width), z * (1 + 10 / CITY.depth)] as XZ);
  const wall = new THREE.ExtrudeGeometry(shapeOf(outer, [[...grid.outline].reverse()]), { depth: 5, bevelEnabled: false, curveSegments: 4 });
  wall.rotateX(-Math.PI / 2);
  const plaza = new THREE.CircleGeometry(PLAZA_RADIUS, 48);
  plaza.rotateX(-Math.PI / 2);
  plaza.translate(0, 0.06, 0);
  g = { floor, wall, plaza };
  gridCache.set(grid, g);
  return g;
}

function buildingMesh(buildings: Building[]): BuildingMesh {
  const geos: THREE.BufferGeometry[] = [];
  const ranges: BuildingMesh["ranges"] = [];
  const colors: number[] = [];
  const roofFlags: number[] = [];
  const wall = new THREE.Color(P.wall);
  let start = 0;
  for (const b of buildings) {
    const ex = new THREE.ExtrudeGeometry(shapeOf(b.footprint.outer, b.footprint.holes), { depth: b.height, bevelEnabled: false, curveSegments: 2 });
    ex.rotateX(-Math.PI / 2);
    const g = ex.index ? ex.toNonIndexed() : ex;
    const count = g.getAttribute("position").count;
    // ExtrudeGeometry: group 0 = caps (roof + base), group 1 = sides.
    const caps = ex.groups[0] ?? { start: 0, count: 0 };
    const roof = new THREE.Color(roofColor(b.use));
    for (let i = 0; i < count; i++) {
      const isCap = i >= caps.start && i < caps.start + caps.count;
      const c = isCap ? roof : wall;
      colors.push(c.r, c.g, c.b);
      roofFlags.push(isCap ? 1 : 0);
    }
    geos.push(g);
    if (g !== ex) ex.dispose();
    ranges.push({ id: b.id, start, count });
    start += count;
  }
  const geometry = mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
  geos.forEach((g) => g.dispose());
  const base = new Float32Array(colors);
  geometry.setAttribute("color", new THREE.BufferAttribute(base.slice(), 3));
  geometry.computeVertexNormals();
  return { geometry, ranges, base, roof: new Uint8Array(roofFlags) };
}

export function levelGeometry(level: Level, grid: Grid): LevelGeometry {
  let g = cache.get(level);
  if (g) return g;
  const outlineLine = new THREE.BufferGeometry().setFromPoints(grid.outline.map(([x, z]) => new THREE.Vector3(x, 0.1, z)));
  g = {
    buildings: buildingMesh(level.buildings),
    paving: flat(level.blocks, 0, 0.18),
    parks: flat(level.open.filter((o) => o.kind === "park").map((o) => o.poly), 0.2),
    yards: flat(level.open.filter((o) => o.kind === "yard").map((o) => o.poly), 0.2),
    outlineLine,
  };
  cache.set(level, g);
  return g;
}

/** Which building a picked vertex belongs to. */
export function buildingAt(mesh: BuildingMesh, vertex: number): string | null {
  let lo = 0, hi = mesh.ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, r = mesh.ranges[mid];
    if (vertex < r.start) hi = mid - 1;
    else if (vertex >= r.start + r.count) lo = mid + 1;
    else return r.id;
  }
  return null;
}

/** Recolor buildings by status in place: dry buildings turn amber, everything else is reset. */
export function paintBuildings(mesh: BuildingMesh, dry: ReadonlySet<string> | ReadonlyMap<string, unknown>, cut: ReadonlySet<string> = new Set()) {
  const attr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  arr.set(mesh.base);
  const dw = new THREE.Color(P.dryWall), dr = new THREE.Color(P.dryRoof);
  const cw = new THREE.Color(P.cutWall), cr = new THREE.Color(P.cutRoof);
  for (const r of mesh.ranges) {
    const isCut = cut.has(r.id);
    if (!dry.has(r.id) && !isCut) continue;
    for (let i = r.start; i < r.start + r.count; i++) {
      const c = isCut ? (mesh.roof[i] ? cr : cw) : mesh.roof[i] ? dr : dw;
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
  }
  attr.needsUpdate = true;
}
