import type { HollowEvent, NewEvent } from "./types";

export const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "http://localhost:8000";

export async function listEvents(params: { type?: string; level?: number; since?: string } = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.level !== undefined) query.set("level", String(params.level));
  if (params.since) query.set("since", params.since);
  const res = await fetch(`${HUB_URL}/events?${query}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as HollowEvent[];
}

export async function addEvent(event: NewEvent) {
  const res = await fetch(`${HUB_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return (await res.json()) as HollowEvent;
}
