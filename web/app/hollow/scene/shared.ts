// Shared by the 3D scene and the panels around it: colors (mirroring globals.css), layout
// constants, layer and selection types, and how a live event maps onto the world.

import type { HollowEvent } from "@/lib/types";
import { isEncrypted, isSOS, isSensor } from "@/lib/useUndercurrent";
import type { World } from "../world/types";

export const C = {
  bg: "#07080c",
  slab: "#171c2e",
  slabEdge: "#3d4970",
  foreground: "#e8e9f0",
  muted: "#8d90a6",
  accent: "#8b7cf6",
  water: "#38bdf8",
  danger: "#ef4444",
  hazard: "#f97316",
  warn: "#f59e0b",
  ok: "#22c55e",
  sim: "#c084fc",
  directorate: "#f43f5e",
  dry: "#3a3f52",
};

export const LEVEL_GAP = 2.4;
export const EXPLODE = 5;
export const baseY = (n: number) => -(n - 1) * LEVEL_GAP;

export type LayerId = "structure" | "water" | "network" | "alerts" | "sensors";
export type LayerMode = "off" | "on" | "focus";
export type Layers = Record<LayerId, LayerMode>;

export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: "structure", label: "Structure", hint: "Levels and buildings (generated)" },
  { id: "water", label: "Water", hint: "Cistern, plant, lift stations, riser, service lines (generated + simulated)" },
  { id: "network", label: "Network", hint: "The two hubs and the link between them (live)" },
  { id: "alerts", label: "Alerts", hint: "Reports and sensor alarms from the hubs (live)" },
  { id: "sensors", label: "Sensors", hint: "Where Canary boxes are mounted" },
];

export const DEFAULT_LAYERS: Layers = { structure: "on", water: "on", network: "on", alerts: "on", sensors: "on" };

/** How strongly a layer shows, given which (if any) layer has focus. */
export function layerAlpha(layers: Layers, id: LayerId): number {
  if (layers[id] === "off") return 0;
  const focused = (Object.keys(layers) as LayerId[]).find((k) => layers[k] === "focus");
  if (!focused || focused === id) return 1;
  return 0.14;
}

export type Selection =
  | { type: "level"; n: number }
  | { type: "building"; id: string }
  | { type: "pipe"; id: string }
  | { type: "node"; id: string }
  | { type: "hub"; id: string }
  | { type: "event"; id: string };

// --- Live events → severity → place in the world ------------------------------------

export type Severity = "sos" | "hazard" | "warn" | "cell" | "info";
export const SEVERITY_RANK: Record<Severity, number> = { sos: 5, hazard: 4, warn: 3, cell: 2, info: 1 };
export const SEVERITY_COLOR: Record<Severity, string> = {
  sos: C.danger, hazard: C.hazard, warn: C.warn, cell: C.accent, info: C.ok,
};

export function severityOf(e: HollowEvent): Severity {
  if (isEncrypted(e)) return "cell";
  if (isSOS(e)) return "sos";
  if (e.type === "hazard") return isSensor(e) || e.payload.severity === "high" ? "hazard" : "warn";
  if (e.type === "case" || e.type === "missing_person") return "warn";
  if (e.type === "checkin" && e.payload.status === "need_help") return "sos";
  return "info";
}

export interface Located {
  event: HollowEvent;
  level: number;
  /** "device": the sensor's mounting point is known. "level": only the level is known. */
  precision: "device" | "level";
  x: number;
  z: number;
}

/**
 * Where an event goes on the map. Exact only when its device_id is a sensor in the world;
 * otherwise it's pinned to the level's marker post, never to an invented spot.
 */
export function locate(e: HollowEvent, world: World): Located {
  const sensor = e.device_id ? world.sensors.find((s) => s.deviceId === e.device_id) : undefined;
  if (sensor && sensor.level === e.level) return { event: e, level: e.level, precision: "device", x: sensor.x, z: sensor.z };
  const { width, depth } = world.config.slab;
  return { event: e, level: e.level, precision: "level", x: -width / 2 + 0.9, z: depth / 2 - 0.9 };
}
