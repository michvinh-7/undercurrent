"use client";

// The Hollow as a map. The active level is drawn in full at y = 0; in the 3D view its
// neighbours float faintly above and below at the same x/z, so shafts line up. All
// geometry is cached per level (geometry.ts); live state only changes colors and markers.

import { MapControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { pinOf, type MapEvent, type Severity } from "../adapter";
import { Line } from "@react-three/drei";
import { CEILING, CISTERN_RADIUS, CORE, pumpId, SOURCE_ID, streetGraph, type CityWorld, type Level, type Route, type WaterState, type WPipe, type XZ } from "../model";
import { buildingAt, gridGeometry, levelGeometry, P, paintBuildings, shapeOf } from "./geometry";

export type View = "3d" | "top";
export type LayerId = "buildings" | "water" | "network" | "alerts" | "sensors";
export type Layers = Record<LayerId, boolean>;
export type Selection =
  | { type: "building"; id: string }
  | { type: "pipe"; id: string }
  | { type: "node"; id: string }
  | { type: "hub"; id: string }
  | { type: "event"; id: string };

export interface HubView { hubId: string; level: number; x: number; z: number; online: boolean; cut: boolean; queued: number; forgery: string | null }

export const SEVERITY_COLOR: Record<Severity, string> = {
  sos: "#c2412d", hazard: "#cf6a2c", caution: "#c98a1b", message: "#6d5fb0", info: "#3b6ea8",
};

export interface CitySceneProps {
  world: CityWorld;
  active: number;
  view: View;
  layers: Layers;
  water: WaterState;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onLevel: (n: number) => void;
  events: MapEvent[];
  fresh: ReadonlySet<string>;
  hubs: HubView[];
  /** Bumps when a new event crosses the link from the sending hub. */
  packetKey: number;
  /** Where the camera should look (x, z on the active level); null = whole level. */
  focus: { x: number; z: number; key: number } | null;
  resetKey: number;
  /** A flood on the active level: where the water was detected and the streets assumed unsafe. */
  flood: { at: XZ; radius: number; blocked: ReadonlySet<string>; spread: boolean } | null;
  route: Route | null;
  /** Buildings with no dry way to the stairs. */
  cut: ReadonlySet<string>;
  /** Bad water traced to a likely source: the pipes downstream of it. */
  trace: { pipes: ReadonlySet<string>; source: string } | null;
  /** Buildings fed through the likely source. */
  risk: ReadonlySet<string>;
}

const GHOST_GAP = 46;
const PIN_H = 13;

export default function CityScene(props: CitySceneProps) {
  const labels = useLabels(props);
  const registry = useRef(new Map<string, HTMLDivElement>());
  return (
    <div className="relative h-full w-full">
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [150, 190, 230], fov: 35, near: 1, far: 3000 }}
      onPointerMissed={() => props.onSelect(null)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[P.sky]} />
      <fog attach="fog" args={[P.sky, 600, 1400]} />
      <hemisphereLight args={["#ffffff", "#b9b1a2", 1.1]} />
      <directionalLight
        position={[90, 160, 70]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-170}
        shadow-camera-right={170}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-bias={-0.0004}
      />
      <Stack {...props} />
      <MapControls makeDefault maxPolarAngle={1.25} minDistance={25} maxDistance={900} enableDamping dampingFactor={0.12} />
      <CameraRig view={props.view} focus={props.focus} resetKey={props.resetKey} active={props.active} />
      <Projector labels={labels} registry={registry} />
    </Canvas>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {labels.map((l) => (
          <div
            key={l.id}
            ref={(el) => { if (el) registry.current.set(l.id, el); else registry.current.delete(l.id); }}
            className="absolute left-0 top-0"
            style={{ visibility: "hidden" }}
          >
            {l.node}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Labels: plain DOM, positioned each frame (no extra React roots) ----------------------

interface Label { id: string; pos: [number, number, number]; node: React.ReactNode }

function useLabels(p: CitySceneProps): Label[] {
  const { world, active, layers, hubs, events, view } = p;
  return useMemo(() => {
    const level = world.levels.find((l) => l.n === active);
    if (!level) return [];
    const out: Label[] = [];
    for (const s of world.grid.streets)
      out.push({ id: `st-${s.id}`, pos: s.dir === "ns" ? [s.at, 0.3, s.to - 10] : [s.to - 22, 0.3, s.at], node: <span className="map-street">{s.name}</span> });
    if (layers.buildings)
      for (const b of level.buildings)
        if (b.use !== "housing" && b.use !== "workshop" && !(layers.alerts && events.some((e) => e.level === active && (e.place.kind === "exact" ? b.use === "pumphouse" : e.place.kind === "named" && e.place.building === b.id))))
          out.push({ id: `b-${b.id}`, pos: [b.center[0], b.height + 2.5, b.center[1]], node: <span className="map-label map-label--minor">{b.name.replace(`L${level.n} `, "")}</span> });
    for (const st of streetGraph(world.grid).stairs)
      out.push({ id: `stairs-${st.id}`, pos: [st.at[0] + (st.at[0] < 0 ? 6 : -6), 4, st.at[1] - 7], node: <span className="map-label map-label--quiet map-label--minor">{st.name}</span> });
    if (p.flood)
      out.push({ id: "flood", pos: [p.flood.at[0] - 4, 2, p.flood.at[1] + 9], node: <span className="map-label map-label--minor" style={{ borderColor: "#5f7f93", color: "#3f5f73" }}>{p.flood.spread ? "Flood (simulated spread)" : "Water detected here"}</span> });
    if (p.trace && layers.water) {
      const at = sourcePoint(world, active, p.trace.source);
      if (at) out.push({ id: "source", pos: [at[0] + 10, 3, at[1] + 6], node: <span className="map-label" style={{ borderColor: "#b07d2a", color: "#7a5418" }}>Likely bad-water source (a guess)</span> });
    }
    if (p.route) {
      const mid = p.route.points[Math.floor(p.route.points.length / 2)];
      out.push({ id: "route", pos: [mid[0], 3, mid[1]], node: <span className="map-label map-label--minor" style={{ borderColor: "#1f8a70", color: "#1f6a56" }}>Safe route · {p.route.minutes} min</span> });
    }
    if (layers.water && world.network.node.get(SOURCE_ID)?.level === active)
      out.push({ id: "cistern", pos: [CORE.cistern[0], 8, CORE.cistern[1]], node: <span className="map-label">Cistern</span> });
    if (layers.sensors)
      for (const s of world.sensors.filter((x) => x.level === active))
        out.push({ id: `s-${s.deviceId}`, pos: [s.x, s.y - 2.2, s.z], node: <span className="map-label map-label--quiet">Canary box · {s.deviceId}</span> });
    if (layers.network) {
      for (const h of hubs.filter((x) => x.level === active)) {
        const status = !h.online ? "offline" : h.cut ? `link cut${h.queued ? ` · ${h.queued} waiting to send` : ""}` : "linked";
        out.push({
          id: `hub-${h.hubId}`, pos: [h.x, 16, h.z],
          node: (
            <span className="map-label" style={{ borderColor: h.cut ? "var(--danger)" : undefined }}>
              Hub {h.hubId.replace("hub-", "")} · <span style={{ color: !h.online ? "var(--faint)" : h.cut ? "var(--danger)" : "var(--ok)" }}>{status}</span>
              {h.forgery && <span className="block text-[var(--danger)]">Forgery refused · {h.forgery}</span>}
            </span>
          ),
        });
      }
      const order = world.levels.map((l) => l.n), ai = order.indexOf(active);
      const [a, b] = hubs;
      if (view === "3d" && a && b && (a.cut || b.cut) && order.includes(a.level) && order.includes(b.level)) {
        const ya = (ai - order.indexOf(a.level)) * GHOST_GAP, yb = (ai - order.indexOf(b.level)) * GHOST_GAP;
        out.push({ id: "link-cut", pos: [a.x, 13 + (ya + yb) / 2, a.z], node: <span className="map-label" style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>Link cut</span> });
      }
    }
    if (layers.alerts) {
      const seen = new Map<string, MapEvent[]>();
      for (const e of events) { const pin = e.level === active ? pinOf(e) : null; if (pin) (seen.get(pin.key) ?? seen.set(pin.key, []).get(pin.key)!).push(e); }
      for (const [dev, list] of seen) {
        const e = list[0];
        const pin = pinOf(e)!;
        const color = SEVERITY_COLOR[e.severity];
        out.push({
          id: `pin-${dev}`, pos: [pin.x, pin.y + PIN_H + 3.4, pin.z],
          node: (
            <span className="map-label" style={{ borderColor: color }}>
              <span style={{ color }}>●</span> {pinTitle(e)}
              {list.length > 1 && <span className="text-[var(--faint)]"> · +{list.length - 1} more</span>}
              {pin.named && <span className="block text-[10px] text-[var(--muted)]">Reported at {pin.named}</span>}
              <span className="block text-[10px] text-[var(--muted)]">{e.demo ? "Demo data" : e.verified ? "Verified by hub" : "Not verified"}</span>
            </span>
          ),
        });
      }
    }
    return out;
  }, [world, active, layers, hubs, events, view, p.flood, p.route, p.trace]);
}

function Projector({ labels, registry }: { labels: Label[]; registry: React.RefObject<Map<string, HTMLDivElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const l of labels) {
      const el = registry.current.get(l.id);
      if (!el) continue;
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.visibility = off ? "hidden" : "visible";
      if (off) continue;
      const x = ((v.x + 1) / 2) * size.width, y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 1e5));
    }
  });
  return null;
}

// --- The level stack -------------------------------------------------------------------

function Stack(p: CitySceneProps) {
  const order = p.world.levels.map((l) => l.n);
  const ai = order.indexOf(p.active);
  return (
    <>
      {p.world.levels.map((l, i) => {
        const offset = (ai - i) * GHOST_GAP; // shallower (smaller n) sits above
        const near = Math.abs(ai - i) <= 2;
        if (l.n === p.active) return <ActiveLevel key={l.n} level={l} {...p} />;
        if (p.view === "top" || !near) return null;
        return <GhostLevel key={l.n} level={l} offset={offset} world={p.world} above={i < ai} />;
      })}
      {p.view === "3d" && p.layers.network && <LinkShaft {...p} />}
    </>
  );
}

function GhostLevel({ level, offset, world, above }: { level: Level; offset: number; world: CityWorld; above: boolean }) {
  // Neighbouring levels, faint, at the same x/z. Levels below show only their outline.
  const g = levelGeometry(level, world.grid);
  const ref = useRef<THREE.Group>(null);
  useSlide(ref, offset);
  return (
    <group ref={ref}>
      <lineLoop geometry={g.outlineLine} raycast={() => null}>
        <lineBasicMaterial color={P.ghost} transparent opacity={above ? 0.5 : 0.35} />
      </lineLoop>
    </group>
  );
}

/** Ease a group's y toward a target each frame (levels slide when you switch). */
function useSlide(ref: React.RefObject<THREE.Group | null>, y: number) {
  const first = useRef(true);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (first.current) { g.position.y = y; first.current = false; return; }
    g.position.y += (y - g.position.y) * Math.min(1, dt * 6);
  });
}

function ActiveLevel(p: CitySceneProps & { level: Level }) {
  const { level, world } = p;
  const g = levelGeometry(level, world.grid);
  const grid = gridGeometry(world.grid);
  const ref = useRef<THREE.Group>(null);
  useSlide(ref, 0);

  // Status only repaints vertex colors.
  useEffect(() => { paintBuildings(g.buildings, p.water.dry, p.cut, p.risk); }, [g, p.water, p.cut, p.risk]);

  const selectedBuilding = p.selection?.type === "building" ? level.buildings.find((b) => b.id === p.selection!.id) : undefined;

  const onBuilding = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.face ? buildingAt(g.buildings, e.face.a) : null;
    if (!id) return;
    p.onSelect(id.endsWith("/pump") ? { type: "node", id: pumpId(level.n) } : { type: "building", id });
  };

  return (
    <group ref={ref}>
      <mesh geometry={grid.floor} receiveShadow raycast={() => null}>
        <meshStandardMaterial color={P.street} roughness={1} />
      </mesh>
      <mesh geometry={grid.wall} castShadow receiveShadow raycast={() => null}>
        <meshStandardMaterial color={P.cavern} roughness={1} />
      </mesh>
      <mesh geometry={grid.plaza} receiveShadow raycast={() => null}>
        <meshStandardMaterial color={P.plaza} roughness={1} />
      </mesh>
      {g.paving && (
        <mesh geometry={g.paving} receiveShadow raycast={() => null}>
          <meshStandardMaterial color={P.paving} roughness={1} />
        </mesh>
      )}
      {g.parks && (
        <mesh geometry={g.parks} receiveShadow raycast={() => null}>
          <meshStandardMaterial color={P.park} roughness={1} />
        </mesh>
      )}
      {g.yards && (
        <mesh geometry={g.yards} receiveShadow raycast={() => null}>
          <meshStandardMaterial color={P.yard} roughness={1} />
        </mesh>
      )}

      {p.layers.buildings && (
        <mesh
          geometry={g.buildings.geometry}
          castShadow
          receiveShadow
          onClick={onBuilding}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}
        >
          <meshStandardMaterial vertexColors roughness={0.92} metalness={0} />
        </mesh>
      )}
      {selectedBuilding && <Highlight outer={selectedBuilding.footprint.outer} holes={selectedBuilding.footprint.holes} height={selectedBuilding.height} />}

      {p.layers.water && <Water {...p} />}
      <Core {...p} />
      <Stairs world={world} />
      {p.flood && <Flood world={world} flood={p.flood} />}
      {p.route && <SafeRoute route={p.route} />}
      {p.trace && p.layers.water && <SourceMarker world={world} level={level.n} id={p.trace.source} />}
      {p.layers.sensors && <Sensors {...p} />}
      {p.layers.alerts && <Pins {...p} />}
    </group>
  );
}

function Highlight({ outer, holes, height }: { outer: [number, number][]; holes: [number, number][][]; height: number }) {
  const geo = useMemo(() => {
    const ex = new THREE.ExtrudeGeometry(shapeOf(outer, holes), { depth: height + 0.3, bevelEnabled: false });
    ex.rotateX(-Math.PI / 2);
    return { edges: new THREE.EdgesGeometry(ex, 20), solid: ex };
  }, [outer, holes, height]);
  useEffect(() => () => { geo.edges.dispose(); geo.solid.dispose(); }, [geo]);
  return (
    <group>
      <lineSegments geometry={geo.edges} renderOrder={5}>
        <lineBasicMaterial color={P.select} linewidth={2} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
      <mesh geometry={geo.solid} raycast={() => null} renderOrder={4}>
        <meshBasicMaterial color={P.select} transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  );
}

// --- Walking: stairs, floods, the safe route ------------------------------------------------

function Stairs({ world }: { world: CityWorld }) {
  return (
    <>
      {streetGraph(world.grid).stairs.map((st) => (
        <group key={st.id} position={[st.at[0] + (st.at[0] < 0 ? 6 : -6), 0, st.at[1] - 7]}>
          <mesh position={[0, 0.25, 0]} receiveShadow raycast={() => null}>
            <boxGeometry args={[8, 0.5, 5]} />
            <meshStandardMaterial color="#8d887e" roughness={1} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[-3 + i * 2, 0.55 + i * 0.35, 0]} castShadow raycast={() => null}>
              <boxGeometry args={[2, 0.35 + i * 0.7, 4.4]} />
              <meshStandardMaterial color="#b5afa3" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

function Flood({ world, flood }: { world: CityWorld; flood: NonNullable<CitySceneProps["flood"]> }) {
  const g = streetGraph(world.grid);
  const blocked = g.edges.filter((e) => flood.blocked.has(e.id));
  // Barriers where a blocked street meets one that's still open.
  const ends = new Map<string, number>();
  for (const e of blocked) for (const k of [e.a, e.b]) ends.set(k, (ends.get(k) ?? 0) + 1);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[flood.at[0], 0.34, flood.at[1]]} raycast={() => null}>
        <circleGeometry args={[flood.radius, 48]} />
        <meshStandardMaterial color={P.flood} transparent opacity={0.5} roughness={0.15} depthWrite={false} />
      </mesh>
      {blocked.map((e) => {
        const [ax, az] = g.pos.get(e.a)!, [bx, bz] = g.pos.get(e.b)!;
        const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bz - az, bx - ax);
        return (
          <group key={e.id}>
            <mesh rotation={[-Math.PI / 2, 0, -ang]} position={[(ax + bx) / 2, 0.3, (az + bz) / 2]} raycast={() => null}>
              <planeGeometry args={[len, e.width]} />
              <meshStandardMaterial color={P.flood} transparent opacity={0.28} depthWrite={false} />
            </mesh>
            {[[ax, az, bx, bz], [bx, bz, ax, az]].map(([x0, z0, x1, z1], i) => {
              const t = Math.min(0.5, 7 / len);
              return (
                <mesh key={i} castShadow position={[x0 + (x1 - x0) * t, 0.7, z0 + (z1 - z0) * t]} rotation={[0, -ang + Math.PI / 2, 0]} raycast={() => null}>
                  <boxGeometry args={[e.width, 1.1, 0.6]} />
                  <meshStandardMaterial color={P.failed} roughness={0.7} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

/** Where the trace points. Drawn only if the source is on this level. */
export function sourcePoint(world: CityWorld, level: number, id: string): XZ | null {
  const n = world.network.node.get(id);
  if (n) return n.level === level ? [n.x, n.z] : null;
  const p = world.network.pipe.get(id);
  if (!p || p.level !== level) return null;
  const a = world.network.node.get(p.from)!, b = world.network.node.get(p.to)!;
  return [(a.x + b.x) / 2, (a.z + b.z) / 2];
}

function SourceMarker({ world, level, id }: { world: CityWorld; level: number; id: string }) {
  const at = sourcePoint(world, level, id);
  if (!at) return null;
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} raycast={() => null}>
        <ringGeometry args={[4.2, 5.2, 40]} />
        <meshBasicMaterial color={P.risk} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.6, 0]} raycast={() => null}>
        <sphereGeometry args={[1.1, 16, 12]} />
        <meshStandardMaterial color={P.risk} />
      </mesh>
    </group>
  );
}

function SafeRoute({ route }: { route: Route }) {
  const pts = useMemo(() => route.points.map(([x, z]) => new THREE.Vector3(x, 0.9, z)), [route]);
  const line = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => { if (line.current) line.current.material.dashOffset -= dt * 6; });
  const end = route.points[route.points.length - 1];
  return (
    <group>
      {/* Drawn over everything so buildings never hide the way out. */}
      <Line points={pts} color="#ffffff" lineWidth={9} depthTest={false} renderOrder={8} transparent opacity={0.85} />
      <Line ref={line as never} points={pts} color={P.route} lineWidth={5} dashed dashSize={3} gapSize={1.6} depthTest={false} renderOrder={9} transparent opacity={1} />
      <mesh position={[end[0], 3, end[1]]} raycast={() => null}>
        <cylinderGeometry args={[1.4, 1.4, 0.5, 24]} />
        <meshStandardMaterial color={P.route} />
      </mesh>
    </group>
  );
}

// --- Water: pipes with water inside, flow arrows, junctions, riser, cistern ---------------

const UP = new THREE.Vector3(0, 1, 0);

function placeSegment(m: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
}

function Water(p: CitySceneProps & { level: Level }) {
  const { world, level, water } = p;
  const net = world.network;
  const pipes = useMemo(() => net.pipes.filter((x) => x.level === level.n && x.kind !== "riser"), [net, level.n]);
  const ends = useMemo(
    () => pipes.map((x) => {
      const a = net.node.get(x.from)!, b = net.node.get(x.to)!;
      return [new THREE.Vector3(a.x, 0.7, a.z), new THREE.Vector3(b.x, 0.7, b.z)] as const;
    }),
    [pipes, net],
  );
  const shell = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color();
    pipes.forEach((x, i) => {
      const [a, b] = ends[i];
      const r = x.kind === "feed" ? 0.85 : 0.6;
      placeSegment(m, a, b, r);
      shell.current!.setMatrixAt(i, m);
      const sel = p.selection?.type === "pipe" && p.selection.id === x.id;
      shell.current!.setColorAt(i, c.set(water.failed.has(x.id) ? P.failed : sel ? P.select : p.trace?.pipes.has(x.id) ? P.risk : P.pipe));
      placeSegment(m, a, b, r * 0.62);
      core.current!.setMatrixAt(i, water.flowing.has(x.id) ? m : zero);
    });
    shell.current!.instanceMatrix.needsUpdate = true;
    if (shell.current!.instanceColor) shell.current!.instanceColor.needsUpdate = true;
    core.current!.instanceMatrix.needsUpdate = true;
    shell.current!.computeBoundingSphere();
  }, [pipes, ends, water, p.selection, p.trace]);

  const junctions = useMemo(() => net.nodes.filter((n) => n.level === level.n && n.kind === "junction"), [net, level.n]);
  const jRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    junctions.forEach((j, i) => { m.makeTranslation(j.x, 0.7, j.z); jRef.current!.setMatrixAt(i, m); });
    jRef.current!.instanceMatrix.needsUpdate = true;
    jRef.current!.computeBoundingSphere();
  }, [junctions]);

  // Service lines from each building to its tap.
  const taps = useMemo(() => net.taps.filter((t) => t.level === level.n), [net, level.n]);
  const service = useMemo(() => {
    const pos: number[] = [];
    for (const t of taps) {
      const b = level.buildings.find((x) => x.id === t.building)!;
      pos.push(t.at[0], 0.5, t.at[1], b.center[0], 0.5, b.center[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    return g;
  }, [taps, level]);
  useEffect(() => () => service.dispose(), [service]);
  useEffect(() => {
    const col = service.getAttribute("color") as THREE.BufferAttribute;
    const wet = new THREE.Color(P.water), dry = new THREE.Color(P.dryRoof);
    taps.forEach((t, i) => {
      const c = water.dry.has(t.building) ? dry : wet;
      for (const k of [0, 1]) col.setXYZ(i * 2 + k, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
  }, [service, taps, water]);

  return (
    <group>
      <instancedMesh
        ref={shell}
        args={[undefined, undefined, Math.max(1, pipes.length)]}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) p.onSelect({ type: "pipe", id: pipes[e.instanceId].id }); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        <meshStandardMaterial transparent opacity={0.55} roughness={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={core} args={[undefined, undefined, Math.max(1, pipes.length)]} raycast={() => null}>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        <meshStandardMaterial color={P.water} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={jRef} args={[undefined, undefined, Math.max(1, junctions.length)]} raycast={() => null}>
        <cylinderGeometry args={[1.05, 1.05, 1.6, 12]} />
        <meshStandardMaterial color="#7d8692" roughness={0.6} />
      </instancedMesh>
      <lineSegments geometry={service} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.55} />
      </lineSegments>
      <FlowArrows pipes={pipes} ends={ends} water={water} />
    </group>
  );
}

function FlowArrows({ pipes, ends, water }: { pipes: WPipe[]; ends: readonly (readonly [THREE.Vector3, THREE.Vector3])[]; water: WaterState }) {
  const slots = useMemo(() => {
    const s: { a: THREE.Vector3; b: THREE.Vector3; phase: number; q: THREE.Quaternion }[] = [];
    pipes.forEach((x, i) => {
      if (!water.flowing.has(x.id)) return;
      const [a, b] = ends[i];
      const len = a.distanceTo(b), k = Math.max(1, Math.round(len / 16));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
      for (let j = 0; j < k; j++) s.push({ a, b, phase: j / k, q });
    });
    return s;
  }, [pipes, ends, water]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime * 0.12;
    slots.forEach((s, i) => {
      v.lerpVectors(s.a, s.b, (s.phase + t) % 1);
      v.y += 1.15;
      m.compose(v, s.q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = slots.length;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, slots.length)]} raycast={() => null} key={slots.length}>
      <coneGeometry args={[0.55, 1.5, 8]} />
      <meshStandardMaterial color={P.water} roughness={0.4} />
    </instancedMesh>
  );
}

// --- The plaza core: riser, lift station, cistern, air shaft --------------------------------

function Core(p: CitySceneProps & { level: Level }) {
  const { level, water, world } = p;
  const pid = pumpId(level.n);
  const pumpFailed = water.failed.has(pid);
  const pumpOk = water.supplied.has(pid) && !pumpFailed;
  const sel = (id: string) => p.selection?.type === "node" && p.selection.id === id;
  const riserWet = water.supplied.has(`L${level.n}/R`);
  const sourceHere = world.network.node.get(SOURCE_ID)?.level === level.n;
  const [rx, rz] = CORE.riser, [px, pz] = CORE.pump, [ax, az] = CORE.air, [cx, cz] = CORE.cistern;
  const click = (id: string) => (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); p.onSelect({ type: "node", id }); };
  return (
    <group>
      {p.layers.water && (
        <group position={[rx, CEILING / 2 - 2, rz]} onClick={click(`L${level.n}/R`)}>
          <mesh>
            <cylinderGeometry args={[1.6, 1.6, CEILING + 4, 16, 1, true]} />
            <meshStandardMaterial color={sel(`L${level.n}/R`) ? P.select : P.pipe} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {riserWet && (
            <mesh>
              <cylinderGeometry args={[1.0, 1.0, CEILING + 4, 12]} />
              <meshStandardMaterial color={P.water} />
            </mesh>
          )}
        </group>
      )}
      {/* Pump on the lift station roof */}
      <group position={[px, 5, pz]} onClick={click(pid)}>
        <mesh castShadow position={[0, 1.1, 0]}>
          <cylinderGeometry args={[1.6, 1.6, 2.2, 20]} />
          <meshStandardMaterial color={pumpFailed ? P.failed : sel(pid) ? P.select : "#4a7189"} roughness={0.5} metalness={0.2} />
        </mesh>
        <mesh position={[0, 2.5, 0]}>
          <cylinderGeometry args={[0.5, 0.5, 0.6, 12]} />
          <meshStandardMaterial color={pumpOk ? P.ok : "#8a8f98"} />
        </mesh>
      </group>
      {/* Air shaft grate (simulated) */}
      <mesh position={[ax, 0.5, az]} receiveShadow raycast={() => null}>
        <boxGeometry args={[7, 1, 7]} />
        <meshStandardMaterial color="#8d8a84" roughness={1} />
      </mesh>
      <mesh position={[ax, 1.02, az]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[5.6, 5.6]} />
        <meshStandardMaterial color="#56534e" roughness={1} />
      </mesh>
      {sourceHere && p.layers.water && (
        <group position={[cx, 0, cz]} onClick={click(SOURCE_ID)}>
          <mesh castShadow receiveShadow position={[0, 3, 0]}>
            <cylinderGeometry args={[CISTERN_RADIUS, CISTERN_RADIUS, 6, 40, 1, true]} />
            <meshStandardMaterial color={sel(SOURCE_ID) ? P.select : "#bdb6a8"} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, water.failed.has(SOURCE_ID) ? 0.6 : 4.6, 0]}>
            <circleGeometry args={[CISTERN_RADIUS - 0.2, 40]} />
            <meshStandardMaterial color={water.failed.has(SOURCE_ID) ? "#9b958a" : P.waterSurface} roughness={0.15} metalness={0.1} />
          </mesh>
        </group>
      )}
      {p.layers.network && p.hubs.filter((h) => h.level === level.n).map((h) => <HubMast key={h.hubId} hub={h} selected={p.selection?.type === "hub" && p.selection.id === h.hubId} onSelect={p.onSelect} />)}
    </group>
  );
}

function HubMast({ hub, selected, onSelect }: { hub: HubView; selected: boolean; onSelect: CitySceneProps["onSelect"] }) {
  const color = !hub.online ? "#8a8f98" : hub.cut ? P.failed : P.ok;
  return (
    <group position={[hub.x, 0, hub.z]} onClick={(e) => { e.stopPropagation(); onSelect({ type: "hub", id: hub.hubId }); }}>
      <mesh castShadow position={[0, 1.5, 0]}>
        <boxGeometry args={[5, 3, 5]} />
        <meshStandardMaterial color={selected ? P.select : "#5c6672"} roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 8, 0]}>
        <cylinderGeometry args={[0.25, 0.4, 10, 8]} />
        <meshStandardMaterial color="#5c6672" />
      </mesh>
      <mesh position={[0, 13.4, 0]}>
        <sphereGeometry args={[0.9, 16, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

/** The link between the two hubs, drawn through the link shaft between their levels. */
function LinkShaft(p: CitySceneProps) {
  const order = p.world.levels.map((l) => l.n);
  const ai = order.indexOf(p.active);
  const [a, b] = p.hubs;
  const ref = useRef<THREE.Mesh>(null);
  const packet = useRef({ key: p.packetKey, t: 1 });
  if (packet.current.key !== p.packetKey) packet.current = { key: p.packetKey, t: 0 };
  const ya = a ? (ai - order.indexOf(a.level)) * GHOST_GAP : 0;
  const yb = b ? (ai - order.indexOf(b.level)) * GHOST_GAP : 0;
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    packet.current.t = Math.min(1, packet.current.t + dt * 0.7);
    m.visible = packet.current.t < 1;
    m.position.y = 13 + ya + (yb - ya) * packet.current.t;
  });
  if (!a || !b || order.indexOf(a.level) < 0 || order.indexOf(b.level) < 0) return null;
  // Only draw when both ends are visible (within two levels) or the active level is one end.
  if (Math.abs(ai - order.indexOf(a.level)) > 2 && Math.abs(ai - order.indexOf(b.level)) > 2) return null;
  const cut = a.cut || b.cut;
  const top = Math.max(ya, yb) + 13, bottom = Math.min(ya, yb) + 13;
  return (
    <group position={[a.x, 0, a.z]}>
      <mesh position={[0, (top + bottom) / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.18, 0.18, top - bottom, 6]} />
        <meshBasicMaterial color={cut ? P.failed : P.ok} transparent opacity={cut ? 0.35 : 0.7} />
      </mesh>
      <mesh ref={ref} visible={false} raycast={() => null}>
        <sphereGeometry args={[1.1, 12, 10]} />
        <meshBasicMaterial color={P.ok} />
      </mesh>
    </group>
  );
}

// --- Sensors and pins -----------------------------------------------------------------------

function Sensors(p: CitySceneProps & { level: Level }) {
  return (
    <>
      {p.world.sensors.filter((s) => s.level === p.level.n).map((s) => (
        <group key={s.deviceId} position={[s.x, s.y, s.z]}>
          <mesh castShadow>
            <boxGeometry args={[1.4, 1.0, 0.6]} />
            <meshStandardMaterial color="#e8b34a" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Pins(p: CitySceneProps & { level: Level }) {
  // One pin per exact spot; the newest event there decides its look.
  const pins = useMemo(() => {
    const at = new Map<string, MapEvent[]>();
    for (const e of p.events) {
      const pin = e.level === p.level.n ? pinOf(e) : null;
      if (!pin) continue;
      const k = pin.key;
      (at.get(k) ?? at.set(k, []).get(k)!).push(e);
    }
    return [...at.values()];
  }, [p.events, p.level.n]);
  return (
    <>
      {pins.map((list) => {
        const top = list[0];
        return (
          <Pin
            key={pinOf(top)!.key}
            e={top}
            count={list.length}
            fresh={p.fresh.has(top.id)}
            selected={p.selection?.type === "event" && list.some((x) => x.id === (p.selection as { id: string }).id)}
            onSelect={() => p.onSelect({ type: "event", id: top.id })}
          />
        );
      })}
    </>
  );
}

function Pin({ e, count, fresh, selected, onSelect }: { e: MapEvent; count: number; fresh: boolean; selected: boolean; onSelect: () => void }) {
  const color = SEVERITY_COLOR[e.severity];
  const ring = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m) return;
    if (!fresh) { m.visible = false; return; }
    born.current ??= clock.elapsedTime;
    const t = (clock.elapsedTime - born.current) / 2.4; // one ripple on arrival, then still
    m.visible = t < 1;
    m.scale.setScalar(1 + t * 9);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
  });
  const pin = pinOf(e);
  if (!pin) return null;
  const { x, y, z } = pin;
  const h = PIN_H;
  return (
    <group position={[x, 0, z]} onClick={(ev) => { ev.stopPropagation(); onSelect(); }}>
      <mesh position={[0, y + h / 2, 0]}>
        <cylinderGeometry args={[0.18, 0.18, h, 6]} />
        <meshStandardMaterial color="#3b3f47" />
      </mesh>
      <mesh position={[0, y + h, 0]}>
        <sphereGeometry args={[selected ? 1.8 : 1.5, 20, 14]} />
        <meshStandardMaterial color={color} transparent opacity={e.verified ? 1 : 0.55} roughness={0.4} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]} visible={false}>
        <ringGeometry args={[1.2, 1.6, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function pinTitle(e: MapEvent): string {
  const p = e.event.payload ?? {};
  if (e.event.type === "hazard") {
    const kind = typeof p.kind === "string" ? p.kind.replace("_", " ") : "hazard";
    return `${kind[0].toUpperCase()}${kind.slice(1)}${e.origin === "sensor" ? " (sensor)" : ""}`;
  }
  if (e.severity === "sos") return "Needs help";
  if (e.severity === "message") return "Private message";
  const t = e.event.type;
  return t === "case" ? "Sickness report" : t === "missing_person" ? "Missing person" : t === "checkin" ? "Check-in" : String(t);
}

// --- Camera --------------------------------------------------------------------------------

function CameraRig({ view, focus, resetKey, active }: { view: View; focus: CitySceneProps["focus"]; resetKey: number; active: number }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as MapControlsImpl | null;
  const goal = useRef<{ target: THREE.Vector3; dist: number; polar: number } | null>(null);
  const far = Math.min(2.2, Math.max(1, 1.3 / (size.width / size.height)));

  useEffect(() => {
    const target = focus ? new THREE.Vector3(focus.x, 0, focus.z) : new THREE.Vector3(0, 0, 0);
    goal.current = { target, dist: (focus ? 110 : 390) * far, polar: view === "top" ? 0.0001 : focus ? 0.85 : 0.82 };
  }, [view, focus, resetKey, active, far]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  const sph = useMemo(() => new THREE.Spherical(), []);
  const off = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = Math.min(1, dt * 3.2);
    controls.target.lerp(g.target, k);
    off.subVectors(camera.position, controls.target);
    sph.setFromVector3(off);
    sph.radius += (g.dist - sph.radius) * k;
    sph.phi += (g.polar - sph.phi) * k;
    if (view === "top") sph.theta += (0 - sph.theta) * k;
    off.setFromSpherical(sph);
    camera.position.copy(controls.target).add(off);
    controls.update();
    if (Math.abs(sph.radius - g.dist) < 0.5 && Math.abs(sph.phi - g.polar) < 0.002 && controls.target.distanceTo(g.target) < 0.2) goal.current = null;
  });
  return null;
}
