"use client";

// The Hollow in 3D. This file only draws: the world comes from world/generate.ts, water state
// from sim/water.ts, live events from the hubs (via HollowApp). Nothing here computes a result.
//
// Layout: 40 level slabs stacked down a central shaft (L1 at the top, L40 deepest). Focusing
// a level lifts every level above it out of the way, so the focused floor is open to view.

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { WaterState } from "../sim/water";
import { isInfrastructure, LINK_XZ, RISER_XZ } from "../world/generate";
import type { Building, BuildingKind, Level, World } from "../world/types";
import {
  baseY, C, EXPLODE, layerAlpha, LEVEL_GAP, SEVERITY_COLOR, SEVERITY_RANK, severityOf,
  type Layers, type Located, type Selection, type Severity,
} from "./shared";

export interface HubView {
  hubId: string;
  level: number;
  online: boolean;
  cut: boolean;
  queued: number;
}

export interface SceneProps {
  world: World;
  layers: Layers;
  focus: number | null;
  onFocus: (n: number | null) => void;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  water: WaterState;
  tracer: { hops: Map<string, number>; step: number } | null;
  located: Located[];
  levelSeverity: Map<number, Severity>;
  hubs: HubView[];
  forgeries: { count: number; reason: string | null };
  packetKey: number; // bumps when a new event crosses the link
  directorate: boolean;
}

const LevelY = createContext<Float32Array>(new Float32Array(41));
const noRaycast = () => null;

// --- Shared geometry ------------------------------------------------------------------

function makeSlab(w: number, d: number, hole: number) {
  const r = 1.4;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const h = new THREE.Path();
  h.absarc(0, 0, hole, 0, Math.PI * 2, true);
  s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false, curveSegments: 28 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.22, 0);
  return g;
}

const KIND_COLOR: Record<BuildingKind, string> = {
  residential: "#3b4878",
  shelter: "#3f8062",
  hospital: "#e4e6f2",
  market: "#5a4c8c",
  workshop: "#3d5665",
  relay: "#6153e0",
  pump_room: "#1d6c94",
  pump_station: "#1d6c94",
  treatment: "#1d6c94",
  reservoir: "#1a5f86",
  air_intake: "#3b4560",
};

// --- Scene ----------------------------------------------------------------------------

export default function Scene(props: SceneProps) {
  const levelY = useMemo(() => {
    const a = new Float32Array(props.world.levels.length + 1);
    for (let n = 1; n < a.length; n++) a[n] = baseY(n);
    return a;
  }, [props.world]);

  return (
    <Canvas
      camera={{ position: [78, 22, 88], fov: 35, near: 0.5, far: 900 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[props.directorate ? "#0d0608" : C.bg]} />
      <fog attach="fog" args={[props.directorate ? "#0d0608" : C.bg, 90, 300]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#aab4ff", "#141626", 0.9]} />
      <directionalLight position={[40, 60, 30]} intensity={1.6} />
      <directionalLight position={[-30, -20, -40]} intensity={0.5} color="#6b7cff" />
      <pointLight position={[0, 10, 0]} intensity={40} distance={60} color={C.accent} />

      <LevelY.Provider value={levelY}>
        <LevelAnimator focus={props.focus} />
        <Shaft levels={props.world.levels.length} />
        {props.world.levels.map((l) => (
          <LevelGroup key={l.n} level={l} {...props} />
        ))}
        <WaterLayer {...props} />
        <NetworkLayer {...props} />
        <AlertLayer {...props} />
        <CameraRig focus={props.focus} />
      </LevelY.Provider>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate={props.focus === null}
        autoRotateSpeed={0.25}
        minDistance={8}
        maxDistance={260}
      />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.75} luminanceSmoothing={0.2} intensity={0.9} />
        <Vignette eskil={false} offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}

/** Moves every level toward its place: home, or lifted away above the focused level. */
function LevelAnimator({ focus }: { focus: number | null }) {
  const levelY = useContext(LevelY);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 4);
    for (let n = 1; n < levelY.length; n++) {
      const target = baseY(n) + (focus !== null && n < focus ? EXPLODE * 7 : 0);
      levelY[n] += (target - levelY[n]) * k;
    }
  });
  return null;
}

function Shaft({ levels }: { levels: number }) {
  const h = levels * LEVEL_GAP + 6;
  return (
    <group position={[0, -h / 2 + 3, 0]}>
      <mesh raycast={noRaycast}>
        <cylinderGeometry args={[3.1, 3.1, h, 48, 1, true]} />
        <meshStandardMaterial color="#1a1f33" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh raycast={noRaycast}>
        <cylinderGeometry args={[0.35, 0.35, h, 12]} />
        <meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.6} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// --- One level: slab, buildings, service lines, label ---------------------------------

function LevelGroup(props: SceneProps & { level: Level }) {
  const { level, world, focus, layers, onFocus, onSelect, selection, water, tracer, levelSeverity, directorate } = props;
  const levelY = useContext(LevelY);
  const ref = useRef<THREE.Group>(null);
  const slabMat = useRef<THREE.MeshStandardMaterial>(null);
  const { slab, edges } = useSlabGeometry(world);
  const buildings = useMemo(() => world.buildings.filter((b) => b.level === level.n), [world, level.n]);

  const n = level.n;
  const isFocus = focus === n;
  const lifted = focus !== null && n < focus;
  const dimmed = focus !== null && !isFocus;
  const sev = levelSeverity.get(n);
  const glow = sev && SEVERITY_RANK[sev] >= SEVERITY_RANK.warn ? SEVERITY_COLOR[sev] : null;
  const structure = layerAlpha(layers, "structure") * (lifted ? 0.06 : dimmed ? 0.22 : 1);
  const alerts = layerAlpha(layers, "alerts");
  const selectedLevel = selection?.type === "level" && selection.n === n;

  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = levelY[n];
    if (slabMat.current) {
      const pulse = sev === "sos" || sev === "hazard" ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 4) : 0.6;
      slabMat.current.emissiveIntensity = glow && alerts > 0 ? (lifted ? 0.1 : (isFocus ? 0.16 : 0.9) * pulse * alerts) : 0;
    }
  });

  const edgeColor = selectedLevel || isFocus ? C.accent : glow && alerts > 0 ? glow : directorate ? "#5a2230" : C.slabEdge;
  const edgeOpacity = lifted ? 0.05 : dimmed ? 0.35 : 0.9;

  return (
    <group ref={ref}>
      <mesh
        geometry={slab}
        raycast={lifted ? noRaycast : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (focus !== n) onFocus(n);
          onSelect({ type: "level", n });
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <meshStandardMaterial
          ref={slabMat}
          color={C.slab}
          emissive={glow ?? "#000000"}
          emissiveIntensity={0}
          roughness={0.85}
          metalness={0.15}
          transparent
          opacity={Math.max(0.04, (lifted ? 0.05 : dimmed ? 0.35 : 0.92) * Math.max(structure, 0.25))}
          depthWrite={!dimmed && !lifted}
        />
      </mesh>
      <lineSegments geometry={edges} raycast={noRaycast}>
        <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} toneMapped={false} />
      </lineSegments>

      {structure > 0 && (
        <Buildings
          list={buildings}
          alpha={structure}
          interactive={!lifted && (focus === null || isFocus)}
          water={water}
          tracer={tracer}
          waterAlpha={layerAlpha(layers, "water")}
          selectedId={selection?.type === "building" ? selection.id : null}
          onPick={(id) => {
            if (focus !== n) onFocus(n);
            onSelect({ type: "building", id });
          }}
        />
      )}

      {isFocus && layerAlpha(layers, "water") > 0 && (
        <ServiceLines world={world} level={n} water={water} tracer={tracer} alpha={layerAlpha(layers, "water")} />
      )}

      <Html position={[-world.config.slab.width / 2 - 0.6, 0.1, world.config.slab.depth / 2]} zIndexRange={[20, 0]}>
          <button
            hidden={!(!lifted && focus === null && (n === 1 || n === 12 || n === 34 || n === 40 || (glow && alerts > 0)))}
            onClick={() => {
              onFocus(n);
              onSelect({ type: "level", n });
            }}
            className="flex -translate-x-full -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded border bg-[#07080ccc] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ borderColor: glow ?? (isFocus ? C.accent : "#2c3350"), color: isFocus ? C.foreground : C.muted }}
          >
            {glow && <span className="h-1.5 w-1.5 rounded-full" style={{ background: glow }} />}L{pad(n)} · {level.name}
          </button>
        </Html>
    </group>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

const slabCache = new WeakMap<World, { slab: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
function useSlabGeometry(world: World) {
  let g = slabCache.get(world);
  if (!g) {
    const slab = makeSlab(world.config.slab.width, world.config.slab.depth, world.config.shaftRadius);
    g = { slab, edges: new THREE.EdgesGeometry(slab, 30) };
    slabCache.set(world, g);
  }
  return g;
}

function buildingColor(b: Building, water: WaterState, tracer: SceneProps["tracer"], waterAlpha: number, out: THREE.Color) {
  out.set(KIND_COLOR[b.kind]);
  if (waterAlpha > 0 && !isInfrastructure(b.kind)) {
    const reached = tracer?.hops.get(b.id);
    if (reached !== undefined && reached <= tracer!.step) return out.set(C.danger);
    if (water.cutOff.has(b.id)) return out.set(C.warn);
  }
  return out;
}

function Buildings({
  list, alpha, interactive, water, tracer, waterAlpha, selectedId, onPick,
}: {
  list: Building[];
  alpha: number;
  interactive: boolean;
  water: WaterState;
  tracer: SceneProps["tracer"];
  waterAlpha: number;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, m.compose(p.set(b.x, b.h / 2, b.z), q, s.set(b.w, b.h, b.d)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [list]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    list.forEach((b, i) => {
      buildingColor(b, water, tracer, waterAlpha, c);
      if (b.id === selectedId) c.set(C.accent);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [list, water, tracer, waterAlpha, selectedId]);

  const selected = list.find((b) => b.id === selectedId);
  return (
    <>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, list.length]}
        raycast={interactive ? THREE.InstancedMesh.prototype.raycast : noRaycast}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onPick(list[e.instanceId].id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <boxGeometry />
        <meshStandardMaterial roughness={0.55} metalness={0.1} emissive="#141a30" transparent opacity={alpha} depthWrite={alpha > 0.99} />
      </instancedMesh>
      {selected && (
        <mesh position={[selected.x, selected.h / 2, selected.z]} scale={[selected.w + 0.25, selected.h + 0.25, selected.d + 0.25]} raycast={noRaycast}>
          <boxGeometry />
          <meshBasicMaterial color={C.accent} wireframe toneMapped={false} />
        </mesh>
      )}
    </>
  );
}

function pipeColor(id: string, water: WaterState, tracer: SceneProps["tracer"], fromId: string, out: THREE.Color) {
  const hop = tracer?.hops.get(fromId);
  if (water.failedPipes.has(id)) return out.set(C.danger);
  if (hop !== undefined && hop < tracer!.step && water.flowing.has(id)) return out.set(C.danger);
  return out.set(water.flowing.has(id) ? C.water : C.dry);
}

/** Service lines on the focused level: riser junction → each building. */
function ServiceLines({ world, level, water, tracer, alpha }: { world: World; level: number; water: WaterState; tracer: SceneProps["tracer"]; alpha: number }) {
  const geo = useMemo(() => {
    const pipes = world.water.pipes.filter((p) => p.kind === "branch" && p.from === `J-${level}`);
    const byId = new Map(world.water.nodes.map((n) => [n.id, n]));
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const p of pipes) {
      const b = byId.get(p.to)!;
      pos.push(RISER_XZ.x, 0.06, RISER_XZ.z, b.x, 0.06, b.z);
      const dry = water.cutOff.has(b.id);
      pipeColor(p.id, water, tracer, p.from, c);
      if (dry) c.set(C.warn);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [world, level, water, tracer]);
  return (
    <lineSegments geometry={geo} raycast={noRaycast}>
      <lineBasicMaterial vertexColors transparent opacity={0.85 * alpha} toneMapped={false} />
    </lineSegments>
  );
}

// --- Water: riser, plant, lift stations, flow particles (spans levels) ----------------

function WaterLayer({ world, water, tracer, layers, onSelect, selection, focus }: SceneProps) {
  const levelY = useContext(LevelY);
  const alpha = layerAlpha(layers, "water");
  const nodes = useMemo(() => new Map(world.water.nodes.map((n) => [n.id, n])), [world]);
  const risers = useMemo(
    () =>
      world.water.pipes
        .filter((p) => p.kind !== "branch")
        .map((p) => ({ pipe: p, a: nodes.get(p.from)!.level, b: nodes.get(p.to)!.level }))
        .filter((r) => r.a !== r.b),
    [world, nodes],
  );
  const plant = useMemo(() => world.water.nodes.filter((n) => n.kind === "reservoir" || n.kind === "treatment" || n.kind === "pump"), [world]);

  const pipeRef = useRef<THREE.InstancedMesh>(null);
  const dropRef = useRef<THREE.InstancedMesh>(null);
  const PER = 3;

  useLayoutEffect(() => {
    const mesh = pipeRef.current;
    if (!mesh) return;
    const c = new THREE.Color();
    risers.forEach((r, i) => {
      pipeColor(r.pipe.id, water, tracer, r.pipe.from, c);
      if (selection?.type === "pipe" && selection.id === r.pipe.id) c.set(C.accent);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [risers, water, tracer, selection]);

  useFrame(({ clock }) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const pipes = pipeRef.current;
    const drops = dropRef.current;
    if (!pipes || !drops) return;
    const t = clock.elapsedTime;
    const c = new THREE.Color();
    risers.forEach((r, i) => {
      const ya = levelY[r.a] + 0.4, yb = levelY[r.b] + 0.4;
      pipes.setMatrixAt(i, m.compose(p.set(RISER_XZ.x, (ya + yb) / 2, RISER_XZ.z), q, s.set(0.16, Math.abs(yb - ya), 0.16)));
      const on = water.flowing.has(r.pipe.id);
      const hop = tracer?.hops.get(r.pipe.from);
      const dirty = hop !== undefined && hop < tracer!.step;
      for (let k = 0; k < PER; k++) {
        const f = (t * 0.55 + k / PER + i * 0.13) % 1;
        const y = ya + (yb - ya) * f;
        drops.setMatrixAt(i * PER + k, m.compose(p.set(RISER_XZ.x, y, RISER_XZ.z), q, s.setScalar(on ? 0.2 : 0)));
        drops.setColorAt(i * PER + k, c.set(dirty ? C.danger : C.water).multiplyScalar(3));
      }
    });
    pipes.instanceMatrix.needsUpdate = true;
    drops.instanceMatrix.needsUpdate = true;
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    pipes.computeBoundingSphere();
  });

  return (
    <group visible={alpha > 0}>
      <instancedMesh
        ref={pipeRef}
        raycast={alpha > 0 ? THREE.InstancedMesh.prototype.raycast : noRaycast}
        args={[undefined, undefined, risers.length]}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onSelect({ type: "pipe", id: risers[e.instanceId].pipe.id });
        }}
      >
        <cylinderGeometry args={[1, 1, 1, 10]} />
        <meshStandardMaterial emissive={C.water} emissiveIntensity={0.25} transparent opacity={0.9 * alpha} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={dropRef} args={[undefined, undefined, risers.length * PER]} raycast={noRaycast}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={alpha} />
      </instancedMesh>
      {plant.map((n) => (
        <PlantNode
          key={n.id}
          id={n.id}
          level={n.level}
          name={n.name}
          failed={water.failedNodes.has(n.id)}
          contaminated={tracer ? (tracer.hops.get(n.id) ?? Infinity) <= tracer.step : false}
          selected={selection?.type === "node" && selection.id === n.id}
          showLabel={alpha === 1 && (focus === n.level || (focus === null && layers.water === "focus"))}
          lifted={focus !== null && n.level < focus}
          onSelect={() => onSelect({ type: "node", id: n.id })}
        />
      ))}
    </group>
  );
}

function PlantNode({
  id, level, name, failed, contaminated, selected, showLabel, lifted, onSelect,
}: {
  id: string; level: number; name: string; failed: boolean; contaminated: boolean; selected: boolean; showLabel: boolean; lifted: boolean;
  onSelect: () => void;
}) {
  const levelY = useContext(LevelY);
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = levelY[level] + 0.55;
    if (mat.current && failed) mat.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 6);
  });
  const color = failed ? C.danger : contaminated ? C.danger : selected ? C.accent : C.water;
  return (
    <group ref={ref} position={[RISER_XZ.x, 0, RISER_XZ.z]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        raycast={lifted ? noRaycast : undefined}
      >
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
      <Html position={[0.8, 0.4, 0]} zIndexRange={[18, 0]}>
          <span
            hidden={!showLabel || lifted}
            className="pointer-events-none whitespace-nowrap rounded bg-[#07080ccc] px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{ color: failed ? C.danger : C.water }}
          >
            {id} · {name}
            {failed ? " · failed (sim)" : ""}
          </span>
        </Html>
    </group>
  );
}

// --- Network: the two hubs, the link, packets, the backlog, refused forgeries -----------

function NetworkLayer({ world, hubs, layers, focus, forgeries, packetKey, onSelect, selection, directorate }: SceneProps) {
  const levelY = useContext(LevelY);
  const alpha = layerAlpha(layers, "network");
  const sites = world.hubs;
  const a = sites.find((h) => h.hubId === "hub-L34")!;
  const b = sites.find((h) => h.hubId === "hub-L12")!;
  const hubA = hubs.find((h) => h.hubId === a.hubId);
  const cut = hubA?.cut ?? false;
  const queued = hubA?.queued ?? 0;

  const linkRef = useRef<THREE.InstancedMesh>(null);
  const packetRef = useRef<THREE.InstancedMesh>(null);
  const PIECES = 36;
  const PACKETS = 10;

  // A bright packet for each new event that crossed the link.
  const bursts = useRef<number[]>([]);
  const clockRef = useRef(0);
  const lastKey = useRef(packetKey);
  useEffect(() => {
    if (packetKey !== lastKey.current) bursts.current = [...bursts.current.slice(-6), clockRef.current];
    lastKey.current = packetKey;
  }, [packetKey]);

  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime;
    const link = linkRef.current, packets = packetRef.current;
    if (!link || !packets) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const ya = levelY[a.level] + 0.9, yb = levelY[b.level] + 0.9;
    const len = (yb - ya) / PIECES;
    for (let i = 0; i < PIECES; i++) {
      const y = ya + len * (i + 0.5);
      const show = !cut || i % 2 === 0;
      link.setMatrixAt(i, m.compose(p.set(LINK_XZ.x, y, LINK_XZ.z), q, s.set(cut ? 0.05 : 0.08, show ? Math.abs(len) * (cut ? 0.55 : 1.02) : 0, cut ? 0.05 : 0.08)));
    }
    link.instanceMatrix.needsUpdate = true;
    link.computeBoundingSphere();
    const t = clock.elapsedTime;
    for (let i = 0; i < PACKETS; i++) {
      let f = -1, size = 0.18;
      if (!cut && i < 3) f = (t * 0.12 + i / 3) % 1; // the link is alive
      const born = bursts.current[i - 3];
      if (!cut && born !== undefined && t - born < 2.2) (f = (t - born) / 2.2), (size = 0.42);
      packets.setMatrixAt(i, m.compose(p.set(LINK_XZ.x, ya + (yb - ya) * Math.max(f, 0), LINK_XZ.z), q, s.setScalar(f < 0 ? 0 : size)));
    }
    packets.instanceMatrix.needsUpdate = true;
  });

  const linkColor = cut ? C.danger : directorate ? C.directorate : C.accent;
  return (
    <group visible={alpha > 0}>
      <instancedMesh ref={linkRef} args={[undefined, undefined, PIECES]} raycast={noRaycast} renderOrder={10}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshBasicMaterial color={linkColor} toneMapped={false} transparent opacity={(cut ? 0.7 : 0.9) * alpha} depthTest={false} />
      </instancedMesh>
      <instancedMesh ref={packetRef} args={[undefined, undefined, PACKETS]} raycast={noRaycast} renderOrder={11}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={new THREE.Color(C.accent).multiplyScalar(3)} toneMapped={false} depthTest={false} />
      </instancedMesh>
      {sites.map((site) => {
        const h = hubs.find((x) => x.hubId === site.hubId);
        return (
          <HubNode
            key={site.hubId}
            id={site.hubId}
            level={site.level}
            online={h?.online ?? false}
            cut={h?.cut ?? false}
            queued={site.hubId === a.hubId ? queued : 0}
            lifted={focus !== null && site.level < focus}
            selected={selection?.type === "hub" && selection.id === site.hubId}
            forgeries={site.hubId === a.hubId ? forgeries : null}
            onSelect={() => onSelect({ type: "hub", id: site.hubId })}
          />
        );
      })}
    </group>
  );
}

function HubNode({
  id, level, online, cut, queued, lifted, selected, forgeries, onSelect,
}: {
  id: string; level: number; online: boolean; cut: boolean; queued: number; lifted: boolean; selected: boolean;
  forgeries: SceneProps["forgeries"] | null; onSelect: () => void;
}) {
  const levelY = useContext(LevelY);
  const ref = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.Mesh>(null);
  const burstAt = useRef(-10);
  const lastCount = useRef<number | null>(null);
  const clockRef = useRef(0);
  useEffect(() => {
    if (!forgeries) return;
    if (lastCount.current !== null && forgeries.count > lastCount.current) burstAt.current = clockRef.current;
    lastCount.current = forgeries.count;
  }, [forgeries]);
  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime;
    if (ref.current) ref.current.position.y = levelY[level] + 0.9;
    if (spin.current) spin.current.rotation.y = clock.elapsedTime * 0.8;
    if (burst.current) {
      const age = clock.elapsedTime - burstAt.current;
      const on = age >= 0 && age < 2.4;
      burst.current.visible = on;
      if (on) {
        burst.current.scale.setScalar(0.6 + age * 2.6);
        (burst.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age / 2.4);
      }
    }
  });
  const color = !online ? C.muted : cut ? C.danger : selected ? C.foreground : C.accent;
  const showForgery = forgeries && clockRef.current - burstAt.current < 4;
  return (
    <group ref={ref} position={[LINK_XZ.x, 0, LINK_XZ.z]}>
      <mesh
        ref={spin}
        renderOrder={12}
        raycast={lifted ? noRaycast : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <octahedronGeometry args={[0.7]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} depthTest={false} transparent />
      </mesh>
      <mesh ref={burst} visible={false} raycast={noRaycast}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={C.danger} wireframe transparent toneMapped={false} depthTest={false} />
      </mesh>
      {Array.from({ length: Math.min(queued, 14) }, (_, i) => (
        <mesh key={i} position={[-1.1 - (i % 2) * 0.45, 0.25 + Math.floor(i / 2) * 0.42, 0]} raycast={noRaycast} renderOrder={12}>
          <boxGeometry args={[0.34, 0.34, 0.34]} />
          <meshBasicMaterial color={new THREE.Color(C.warn).multiplyScalar(2)} toneMapped={false} depthTest={false} transparent />
        </mesh>
      ))}
      <Html position={[0, 1.1, 0]} center zIndexRange={[30, 0]}>
          <div hidden={lifted} className="pointer-events-none flex flex-col items-center gap-0.5 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider">
            <span className="rounded bg-[#07080cdd] px-1.5 py-0.5" style={{ color, boxShadow: `inset 0 0 0 1px ${color}` }}>
              {id.replace("hub-", "Hub ")} · {!online ? "no answer" : cut ? "link cut" : "online"}
            </span>
            {cut && queued > 0 && <span className="rounded bg-[#07080cdd] px-1.5 py-0.5 text-[var(--warn)]">{queued} waiting to send</span>}
            {showForgery && forgeries?.reason && (
              <span className="rounded bg-[#07080cdd] px-1.5 py-0.5 text-[var(--danger)]">Forgery refused · {forgeries.reason}</span>
            )}
          </div>
        </Html>
    </group>
  );
}

// --- Alerts and sensors -----------------------------------------------------------------

function AlertLayer({ world, located, layers, focus, onSelect, selection, directorate }: SceneProps) {
  const alerts = layerAlpha(layers, "alerts");
  const sensors = layerAlpha(layers, "sensors");
  // Level-only events share one post per level; device events get their own marker.
  const markers = useMemo(() => {
    const out = new Map<string, Located[]>();
    for (const l of located) {
      const key = l.precision === "device" ? `d:${l.event.device_id}:${l.level}` : `l:${l.level}`;
      out.set(key, [...(out.get(key) ?? []), l]);
    }
    return [...out.values()].map((group) => {
      const worst = group.reduce((a, b) => (SEVERITY_RANK[severityOf(b.event)] > SEVERITY_RANK[severityOf(a.event)] ? b : a));
      return { group, worst, sev: severityOf(worst.event) };
    });
  }, [located]);

  return (
    <group>
      {markers.map(({ group, worst, sev }) => (
          <Marker
            key={`${worst.precision}:${worst.level}:${worst.event.device_id ?? ""}`}
            located={worst}
            count={group.length}
            sev={sev}
            alpha={alerts}
            overview={focus === null}
            lifted={focus !== null && worst.level < focus}
            dimmed={focus !== null && worst.level !== focus}
            selected={selection?.type === "event" && group.some((g) => g.event.id === selection.id)}
            directorate={directorate}
            onSelect={() => onSelect({ type: "event", id: worst.event.id })}
          />
        ))}
      {world.sensors.map((s) => (
          <SensorMount key={s.deviceId} level={s.level} x={s.x} z={s.z} id={s.deviceId} hardware={s.hardware}
            top={world.buildings.find((b) => b.id === s.buildingId)?.h ?? 1}
            lifted={focus !== null && s.level < focus || sensors === 0}
            showLabel={focus === s.level} />
        ))}
    </group>
  );
}

function Marker({
  located, count, sev, alpha, overview, lifted, dimmed, selected, directorate, onSelect,
}: {
  located: Located; count: number; sev: Severity; alpha: number; overview: boolean; lifted: boolean; dimmed: boolean; selected: boolean;
  directorate: boolean; onSelect: () => void;
}) {
  const levelY = useContext(LevelY);
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const color = SEVERITY_COLOR[sev];
  const urgent = sev === "sos" || sev === "hazard";
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = levelY[located.level];
    if (ring.current) {
      const f = urgent ? (clock.elapsedTime * 0.8) % 1 : 0.5;
      ring.current.scale.setScalar(0.6 + f * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (urgent ? 1 - f : 0.5) * alpha * (dimmed ? 0.3 : 1);
    }
  });
  const hidden = lifted || alpha === 0;
  const height = located.precision === "device" ? 3.2 : 2.2;
  const bright = new THREE.Color(color).multiplyScalar(dimmed ? 0.6 : 2.4);
  return (
    <group ref={ref} position={[located.x, 0, located.z]} visible={!hidden}>
      <mesh position={[0, height / 2, 0]} raycast={hidden ? noRaycast : undefined} onClick={(e) => (e.stopPropagation(), onSelect())}>
        <cylinderGeometry args={[selected ? 0.12 : 0.07, 0.07, height, 8]} />
        <meshBasicMaterial color={bright} toneMapped={false} transparent opacity={alpha} />
      </mesh>
      <mesh position={[0, height, 0]} onClick={(e) => (e.stopPropagation(), onSelect())}>
        <sphereGeometry args={[selected ? 0.38 : 0.28, 16, 12]} />
        <meshBasicMaterial color={bright} toneMapped={false} transparent opacity={alpha} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.55, 0.7, 40]} />
        <meshBasicMaterial color={bright} toneMapped={false} transparent side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0, height + 0.5, 0]} center zIndexRange={[25, 0]}>
          <button
            hidden={hidden || dimmed || overview}
            onClick={onSelect}
            className="whitespace-nowrap rounded bg-[#07080cdd] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ color, boxShadow: `inset 0 0 0 1px ${color}` }}
          >
            {sev === "cell" ? (directorate ? "▓▓▓ encrypted" : "cell message") : labelFor(located)}
            {count > 1 ? ` +${count - 1}` : ""}
          </button>
        </Html>
    </group>
  );
}

function labelFor(l: Located) {
  const e = l.event;
  if (e.type === "hazard") return `${String(e.payload.kind ?? "hazard").replace("_", " ")}${e.device_id ? ` · ${e.device_id}` : ""}`;
  if (e.type === "checkin") return e.payload.status === "need_help" ? "SOS" : "check-in";
  if (e.type === "case") return "symptoms";
  if (e.type === "missing_person") return "missing";
  return e.type;
}

function SensorMount({ level, x, z, id, hardware, top, lifted, showLabel }: { level: number; x: number; z: number; id: string; hardware: boolean; top: number; lifted: boolean; showLabel: boolean }) {
  const levelY = useContext(LevelY);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = levelY[level] + top + 0.2;
      ref.current.rotation.y = clock.elapsedTime;
    }
  });
  return (
    <group ref={ref} position={[x, 0, z]} visible={!lifted}>
      <mesh raycast={noRaycast}>
        <boxGeometry args={[0.36, 0.36, 0.36]} />
        <meshBasicMaterial color={new THREE.Color(C.water).multiplyScalar(2.2)} toneMapped={false} />
      </mesh>
      <Html position={[0.5, 0.2, 0]} zIndexRange={[19, 0]}>
          <span hidden={!showLabel || lifted} className="pointer-events-none whitespace-nowrap rounded bg-[#07080cdd] px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--water)]">
            {id} · {hardware ? "Canary box (hardware)" : "planned"}
          </span>
        </Html>
    </group>
  );
}

// --- Camera -----------------------------------------------------------------------------

function CameraRig({ focus }: { focus: number | null }) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }) | null;
    size: { width: number; height: number };
  };
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  // Narrow screens (phones) need the camera further back to fit the slab's width.
  const far = Math.min(Math.max(1.25 / (size.width / size.height), 1), 2.2);

  useEffect(() => {
    if (focus === null) {
      const target = new THREE.Vector3(0, -50, 0);
      goal.current = { pos: new THREE.Vector3(78, 72, 88).multiplyScalar(far).add(target), target };
    } else {
      const target = new THREE.Vector3(0, baseY(focus) - 1, 0);
      goal.current = { pos: new THREE.Vector3(22, 22, 31).multiplyScalar(far).add(target), target };
    }
  }, [focus, far]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => (goal.current = null); // the user grabbed the camera: stop steering
    controls.addEventListener("start" as never, stop as never);
    return () => controls.removeEventListener("start" as never, stop as never);
  }, [controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 2.6);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.target, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && controls.target.distanceTo(g.target) < 0.05) goal.current = null;
  });
  return null;
}
