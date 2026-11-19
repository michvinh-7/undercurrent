// Sensor alerts → what the map does with them. One row per kind in SENSOR_LOOK; to support a
// new kind of sensor, add a row here and (if it needs one) a sentence in narrate.ts.
//
// What a Canary box sends (a hazard event, source "sensor", device_id = its mount):
//   payload.kind             "flooding" | "bad_air" | "heat" | "blackout"   (schema enum)
//   payload.severity         "low" | "medium" | "high"
//   payload.reading          optional, { value: number, unit: string }, e.g. { value: 182, unit: "ppm" }
//   payload.expected_in_min  optional, minutes until it's expected to happen (a warning, not yet real)
// reading and expected_in_min are proposed additions; the map reads them if present and works without.
//
// Pure TypeScript with type-only imports, so node --test can load it.

import type { MapEvent } from "./adapter";

export type ZoneKind = "flooding" | "bad_air" | "heat" | "blackout";

export const SENSOR_LOOK: Record<ZoneKind, { label: string; color: string; radius: number; blocksStreets: boolean }> = {
  flooding: { label: "Flooding", color: "#5f7f93", radius: 16, blocksStreets: true },
  bad_air: { label: "Bad air", color: "#7f8c5a", radius: 22, blocksStreets: true },
  heat: { label: "Heat", color: "#d0743c", radius: 30, blocksStreets: false },
  blackout: { label: "Blackout", color: "#8a93ab", radius: 40, blocksStreets: false },
};

/** The box at the top of the shaft that reads the surface air (question 13). Not on a map level. */
export const SURFACE_DEVICE = "canary-surface";

const payloadOf = (m: MapEvent): Record<string, unknown> => (m.event.payload && typeof m.event.payload === "object" ? m.event.payload : {});
const KINDS = Object.keys(SENSOR_LOOK) as ZoneKind[];

/** "182 ppm", or null. Accepts { value, unit } or a bare number. */
export function readingOf(m: MapEvent): string | null {
  const r = payloadOf(m).reading;
  if (typeof r === "number" && Number.isFinite(r)) return String(r);
  if (r && typeof r === "object") {
    const { value, unit } = r as { value?: unknown; unit?: unknown };
    if (typeof value === "number" && Number.isFinite(value)) return `${value}${typeof unit === "string" && unit ? `${unit === "°C" ? "" : " "}${unit}` : ""}`;
  }
  return null;
}

/** Minutes until a warned-of event, or null when it's happening now. */
export function expectedInOf(m: MapEvent): number | null {
  const v = payloadOf(m).expected_in_min;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

export const kindOf = (m: MapEvent): ZoneKind | null => {
  const k = payloadOf(m).kind;
  return m.event.type === "hazard" && typeof k === "string" && (KINDS as string[]).includes(k) ? (k as ZoneKind) : null;
};

export interface SensorAlert {
  kind: ZoneKind;
  event: MapEvent;
  /** The box's mount on the map, or null when only the level is known. */
  at: [number, number] | null;
  reading: string | null;
  expectedIn: number | null;
}

/**
 * Sensor hazards on a level from the last `hours`, newest first, one per kind and box (a box's
 * newest reading replaces its older ones). Reports from people are not sensor alerts.
 */
export function activeSensorAlerts(events: MapEvent[], level: number, now = Date.now(), hours = 24): SensorAlert[] {
  const seen = new Set<string>();
  const out: SensorAlert[] = [];
  for (const e of events) {
    if (e.origin !== "sensor" || e.level !== level || now - e.time > hours * 3600e3) continue;
    const kind = kindOf(e);
    if (!kind) continue;
    const key = `${kind}:${e.event.device_id ?? "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, event: e, at: e.place.kind === "exact" ? [e.place.x, e.place.z] : null, reading: readingOf(e), expectedIn: expectedInOf(e) });
  }
  return out;
}

/** Buildings within a radius of a point (all of them when the point is unknown). */
export function buildingsNear<B extends { id: string; center: [number, number] }>(buildings: readonly B[], at: [number, number] | null, radius: number): Set<string> {
  return new Set(buildings.filter((b) => !at || Math.hypot(b.center[0] - at[0], b.center[1] - at[1]) <= radius).map((b) => b.id));
}

/** The latest surface-air reading, from the box at the top of the shaft. */
export function surfaceReading(events: MapEvent[]): MapEvent | null {
  return events.find((e) => e.event.device_id === SURFACE_DEVICE) ?? null;
}

/** Sensor alerts per level over the last week: the signed record of who's going without (question 2). */
export function outageLedger(events: MapEvent[], levels: number[], now = Date.now(), days = 7): { level: number; blackouts: number; badAir: number; flooding: number; heat: number }[] {
  return levels.map((n) => {
    const here = events.filter((e) => e.level === n && e.origin === "sensor" && now - e.time <= days * 86400e3 && expectedInOf(e) === null);
    const count = (k: ZoneKind) => here.filter((e) => kindOf(e) === k).length;
    return { level: n, blackouts: count("blackout"), badAir: count("bad_air"), flooding: count("flooding"), heat: count("heat") };
  });
}
