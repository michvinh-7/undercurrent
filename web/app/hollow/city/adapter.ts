// Live events → things the map can draw. The renderer only ever sees MapEvent, never raw
// hub responses. Rules:
//   - A pin goes at an exact spot ONLY when the event's device_id is a sensor whose mount
//     the world knows, on the same level. Everything else is "somewhere on L34" or unknown.
//   - Never invent coordinates. Never decide authenticity here: `verified` comes from the
//     hub-backed check passed in by the caller (useUndercurrent.isVerified).
// Pure TypeScript with type-only imports, so node --test can load it.

import type { HollowEvent } from "@/lib/types";
import type { CityWorld } from "./model";

export type Severity = "sos" | "hazard" | "caution" | "message" | "info";
export const SEVERITY_RANK: Record<Severity, number> = { sos: 5, hazard: 4, caution: 3, message: 2, info: 1 };
export const SEVERITY_LABEL: Record<Severity, string> = { sos: "Needs help", hazard: "Hazard", caution: "Caution", message: "Private message", info: "Update" };

export type Place =
  | { kind: "exact"; x: number; z: number; y: number; deviceId: string }
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
  time: number;
}

// Mirrors the predicates in lib/useUndercurrent (kept local so this file has no runtime imports).
const SOS_PRIORITY = 0.9;
const payloadOf = (e: HollowEvent): Record<string, unknown> => (e.payload && typeof e.payload === "object" ? e.payload : {});
const isEncrypted = (e: HollowEvent) => payloadOf(e).enc === true;
const isSensor = (e: HollowEvent) => e.source === "sensor";

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
    place = s && s.level === level ? { kind: "exact", x: s.x, z: s.z, y: s.y, deviceId: s.deviceId } : { kind: "level" };
  }
  const t = Date.parse(e.created_at);
  let verified = false;
  try { verified = opts.isVerified(e); } catch { verified = false; }
  return {
    id: e.id, event: e, level, onMap, place,
    severity: severityOf(e), verified, origin: isSensor(e) ? "sensor" : "report",
    demo: opts.demo, time: Number.isFinite(t) ? t : 0,
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
  return { n, total: here.length, worst, exact: here.filter((e) => e.place.kind === "exact").length, levelOnly: here.filter((e) => e.place.kind === "level").length };
}
