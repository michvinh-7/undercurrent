// The generated Hollow: what exists. Events (what happens) stay in the hub's log; the map
// only joins the two by level and device_id. Everything in a World is GENERATED from a
// seed and labeled that way in the UI. It is not a real infrastructure map.

export type District = "access" | "residential" | "relay" | "market" | "works" | "water" | "deep";

export type BuildingKind =
  | "residential"
  | "shelter"
  | "hospital"
  | "market"
  | "workshop"
  | "relay"
  | "pump_room"
  | "pump_station"
  | "treatment"
  | "reservoir"
  | "air_intake";

export interface WorldConfig {
  seed: number;
  levels: number;
  population: number;
  slab: { width: number; depth: number };
  grid: { cols: number; rows: number };
  shaftRadius: number;
}

export interface Level {
  n: number; // 1 = just under the surface, 40 = the deepest
  name: string;
  district: District;
  population: number;
}

export interface Building {
  id: string;
  kind: BuildingKind;
  name: string;
  level: number;
  cell: [number, number];
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  capacity: number;
  population: number;
}

export type WaterNodeKind = "reservoir" | "treatment" | "pump" | "junction" | "consumer";

export interface WaterNode {
  id: string;
  kind: WaterNodeKind;
  level: number;
  name: string;
  buildingId?: string;
  x: number;
  z: number;
}

export type PipeKind = "main" | "riser" | "branch";

export interface Pipe {
  id: string;
  kind: PipeKind;
  from: string; // water flows from → to
  to: string;
}

export interface Sensor {
  deviceId: string;
  level: number;
  buildingId: string;
  x: number;
  z: number;
  measures: string[];
  hardware: boolean; // true = a real Canary box; false = planned / simulated
}

export interface HubSite {
  hubId: string;
  level: number;
  x: number;
  z: number;
}

export interface World {
  config: WorldConfig;
  levels: Level[];
  buildings: Building[];
  water: { nodes: WaterNode[]; pipes: Pipe[] };
  sensors: Sensor[];
  hubs: HubSite[];
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}
