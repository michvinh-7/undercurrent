// Live events → things the map can draw. The renderer only ever sees MapEvent, never raw
// hub responses. Rules:
//   - A pin goes at an exact spot ONLY when the event's device_id is a sensor whose mount
//     the world knows, on the same level. Everything else is "somewhere on L34" or unknown.
//   - Never invent coordinates. Never decide authenticity here: `verified` comes from the
//     hub-backed check passed in by the caller (useUndercurrent.isVerified).
// Pure TypeScript with type-only imports, so node --test can load it.

import type { HollowEvent } from "@/lib/types";
import type { CityWorld } from "./model";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** Match free text like "Pumpwell St" or "the hospital" to a street or building on the level. */
export function matchPlace(text: unknown, world: CityWorld, level: number): Extract<Place, { kind: "named" }> | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = words(text);
  const has = (phrase: string) => { const w = words(phrase); return w.length > 0 && w.every((x) => t.includes(x)); };
  const l = world.levels.find((x) => x.n === level);
  if (!l) return null;
  for (const s of world.grid.streets) {
    const core = s.name.split(" ")[0];
    const suffix = t.some((w) => ["st", "street", "ave", "avenue", "row", "blvd", "boulevard", "way", "gallery"].includes(w));
    if (has(s.name) || (suffix && t.includes(core.toLowerCase()))) {
      const mid = (s.from + s.to) / 2;
      return { kind: "named", name: s.name, street: s.name, x: s.dir === "ns" ? s.at : mid, z: s.dir === "ns" ? mid : s.at, y: 0.5 };
    }
  }
  for (const b of l.buildings) {
    if (b.use === "housing" || b.use === "workshop") continue;
    const label = b.name.replace(`L${level} `, "");
    if (has(label)) return { kind: "named", name: label, building: b.id, x: b.center[0], z: b.center[1], y: b.height };
  }
  return null;
}

export type Severity = "sos" | "hazard" | "caution" | "message" | "info";
export const SEVERITY_RANK: Record<Severity, number> = { sos: 5, hazard: 4, caution: 3, message: 2, info: 1 };
export const SEVERITY_LABEL: Record<Severity, string> = { sos: "Needs help", hazard: "Hazard", caution: "Caution", message: "Private message", info: "Update" };

export type Place =
  | { kind: "exact"; x: number; z: number; y: number; deviceId: string }
  /** The report's own location text names a street or building on that level. */
  | { kind: "named"; name: string; street?: string; building?: string; x: number; z: number; y: number }
  | { kind: "level" }
  | { kind: "unknown"; reason: string };

export interface MapEvent {
  id: string;
  event: HollowEvent;
  /** null when the event has no usable level. */
  level: number | null;
  /** The level is one the map currently has. */
  onMap: boolean;
  place: Place;
  severity: Severity;
  verified: boolean;
  /** "sensor": a Canary box reading; "report": a person's report. */
  origin: "sensor" | "report";
  /** True when the whole feed is labelled demo data (no hub reachable). */
  demo: boolean;
  /** A test alert made on the map page (id "test-…"), never from a hub and never verified. */
  test: boolean;
  /** Sent by the simulation (payload.simulated, inside the signature): verified, but not a real box or resident. */
  simulated: boolean;
  time: number;
}

// Mirrors the predicates in lib/useUndercurrent (kept local so this file has no runtime imports).
const SOS_PRIORITY = 0.9;
const payloadOf = (e: HollowEvent): Record<string, unknown> => (e.payload && typeof e.payload === "object" ? e.payload : {});
const isEncrypted = (e: HollowEvent) => payloadOf(e).enc === true;
const isSensor = (e: HollowEvent) => e.source === "sensor";

/** Where to draw a pin, if the event has a real spot (a sensor mount or a place the report names). */
export function pinOf(m: MapEvent): { key: string; x: number; y: number; z: number; named: string | null } | null {
  if (m.place.kind === "exact") return { key: m.place.deviceId, x: m.place.x, y: m.place.y, z: m.place.z, named: null };
  if (m.place.kind === "named") return { key: `named:${m.place.name}`, x: m.place.x, y: m.place.y, z: m.place.z, named: m.place.name };
  return null;
}

export function severityOf(e: HollowEvent): Severity {
  const p = payloadOf(e);
  if (isEncrypted(e)) return "message";
  if ((e.priority ?? 0) >= SOS_PRIORITY || (e.type === "checkin" && p.status === "need_help")) return "sos";
  if (e.type === "hazard") return isSensor(e) || p.severity === "high" ? "hazard" : "caution";
  if (e.type === "case" || e.type === "missing_person") return "caution";
  return "info";
}

export interface AdaptOptions {
  isVerified: (e: HollowEvent) => boolean;
  demo: boolean;
}

/** One event → MapEvent, or null if it's too malformed to show at all (no id). */
export function adaptEvent(raw: unknown, world: CityWorld, opts: AdaptOptions): MapEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as HollowEvent;
  if (typeof e.id !== "string" || !e.id) return null;
  const level = typeof e.level === "number" && Number.isInteger(e.level) && e.level > 0 ? e.level : null;
  const onMap = level !== null && world.levels.some((l) => l.n === level);
  let place: Place;
  if (level === null) place = { kind: "unknown", reason: "No level given" };
  else {
    const s = e.device_id ? world.sensors.find((m) => m.deviceId === e.device_id) : undefined;
    place = s && s.level === level
      ? { kind: "exact", x: s.x, z: s.z, y: s.y, deviceId: s.deviceId }
      : matchPlace(payloadOf(e).location, world, level)
        // A check-in has no location field, so its note can name the place ("stuck at Cistern Row").
        ?? (e.type === "checkin" ? matchPlace(payloadOf(e).note, world, level) : null)
        ?? { kind: "level" };
  }
  const t = Date.parse(e.created_at);
  let verified = false;
  try { verified = !e.id.startsWith("test-") && opts.isVerified(e); } catch { verified = false; }
  return {
    id: e.id, event: e, level, onMap, place,
    severity: severityOf(e), verified, origin: isSensor(e) ? "sensor" : "report",
    demo: opts.demo, test: e.id.startsWith("test-"), simulated: payloadOf(e).simulated === true, time: Number.isFinite(t) ? t : 0,
  };
}

/** All events → MapEvents: one per id (the latest copy wins), newest first, roster entries dropped. */
export function adaptEvents(events: readonly unknown[], world: CityWorld, opts: AdaptOptions): MapEvent[] {
  const byId = new Map<string, MapEvent>();
  for (const raw of events) {
    const m = adaptEvent(raw, world, opts);
    if (m && m.event.type !== "roster") byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => b.time - a.time || (a.id < b.id ? -1 : 1));
}

export interface LevelSummary { n: number; total: number; worst: Severity | null; exact: number; levelOnly: number }
export function summarize(events: MapEvent[], n: number): LevelSummary {
  const here = events.filter((e) => e.level === n);
  let worst: Severity | null = null;
  for (const e of here) if (!worst || SEVERITY_RANK[e.severity] > SEVERITY_RANK[worst]) worst = e.severity;
  return { n, total: here.length, worst, exact: here.filter((e) => e.place.kind === "exact" || e.place.kind === "named").length, levelOnly: here.filter((e) => e.place.kind === "level").length };
}

// --- What a report is about -------------------------------------------------------------------

const WATER_WORDS = ["diarrhea", "diarrhoea", "vomiting", "stomach", "cramps", "nausea", "dysentery"];
const LUNG_WORDS = ["cough", "coughing", "breath", "breathing", "wheezing", "chest", "lung"];
const symptomsOf = (e: HollowEvent) => {
  const s = payloadOf(e).symptoms;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : [];
};
const mentions = (xs: string[], list: string[]) => xs.some((x) => list.some((w) => x.includes(w)));

/** Bad-water hazards, or sickness reports with stomach symptoms. */
export const isWaterReport = (m: MapEvent) =>
  (m.event.type === "hazard" && payloadOf(m.event).kind === "bad_water") ||
  (m.event.type === "case" && mentions(symptomsOf(m.event), WATER_WORDS));
/** Sickness reports with breathing symptoms. */
export const isLungReport = (m: MapEvent) => m.event.type === "case" && mentions(symptomsOf(m.event), LUNG_WORDS);
export const peopleIn = (m: MapEvent) => { const n = payloadOf(m.event).people_affected; return typeof n === "number" && n > 0 ? n : 1; };
export const checkinStatus = (m: MapEvent): "ok" | "need_help" | null =>
  m.event.type === "checkin" ? (payloadOf(m.event).status === "need_help" ? "need_help" : "ok") : null;

// --- Residents ------------------------------------------------------------------------------
// Assigning a person to a building is an ordinary signed check-in whose payload also names the
// building: { status: "ok", home: "L34/b12", name: "Ana" }. No new event type, so the hub, the
// schema and sync are unchanged, and every hub and every viewer sees the same assignments.

export interface Resident { name: string; building: string; at: string; simulated: boolean }

/** Who is in which building: the newest assignment per name wins (assigning a name again moves them). */
export function homesFrom(events: readonly HollowEvent[]): Map<string, Resident[]> {
  const latest = new Map<string, Resident>();
  for (const e of events) {
    if (e.type !== "checkin") continue;
    const p = payloadOf(e);
    if (typeof p.home !== "string" || typeof p.name !== "string" || !p.name.trim()) continue;
    const key = p.name.trim().toLowerCase();
    const prev = latest.get(key);
    if (prev && prev.at >= e.created_at) continue;
    latest.set(key, { name: p.name.trim(), building: p.home, at: e.created_at, simulated: p.simulated === true });
  }
  const byBuilding = new Map<string, Resident[]>();
  for (const r of latest.values()) byBuilding.set(r.building, [...(byBuilding.get(r.building) ?? []), r]);
  for (const list of byBuilding.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byBuilding;
}
