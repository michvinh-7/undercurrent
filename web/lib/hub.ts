import type { HollowEvent, NewEvent } from "./types";

/**
 * Where the hub is. NEXT_PUBLIC_HUB_URL wins if set. Otherwise use the machine
 * that served this page on port 8000, so a phone that opened http://<laptop-ip>:3000
 * talks to http://<laptop-ip>:8000 instead of to itself.
 */
export function hubUrl(): string {
  if (process.env.NEXT_PUBLIC_HUB_URL) return process.env.NEXT_PUBLIC_HUB_URL;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:8000`;
  return "http://localhost:8000";
}

export async function listEvents(params: { type?: string; level?: number; since?: string } = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.level !== undefined) query.set("level", String(params.level));
  if (params.since) query.set("since", params.since);
  const res = await fetch(`${hubUrl()}/events?${query}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as HollowEvent[];
}

export async function addEvent(event: NewEvent) {
  const res = await fetch(`${hubUrl()}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as HollowEvent;
}

export interface LinkStatus {
  bandwidth_bps: number | null;
  cut: boolean;
  queued: number;
  queued_bytes: number;
}

export async function getLink() {
  const res = await fetch(`${hubUrl()}/link`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as LinkStatus;
}

export async function setLink(settings: { bandwidth_bps?: number; unlimited?: boolean; cut?: boolean }) {
  const res = await fetch(`${hubUrl()}/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as LinkStatus;
}
