// The phone's outbox: a report that can't reach the hub waits on the phone and sends itself
// when the hub is back. The same promise as the link between hubs, at the last mile.
//
// - Queued unsigned, with its id fixed and `written_at` (when the resident wrote it) in the
//   payload. It's signed when it actually goes, so created_at is fresh: the hub refuses a
//   signed post more than 5 minutes old (REPLAY_WINDOW_S), and an outage can last longer.
//   written_at is inside the signature from then on, so the hub stores the real writing time.
// - At most once: the id never changes, so if a send got through but the answer was lost,
//   the retry comes back "replay: duplicate id", which counts as delivered.
// - Refused by the hub for another reason (say the phone isn't on the roster): it stays in
//   the list, marked, until the resident discards it. Never dropped silently.
// - Kept in localStorage, so it survives a reload or the browser being closed.
// Relative imports only, so node --test can load it (see lib/node-ts-resolve.mjs).

import { hubUrl } from "./hub";
import { NotJoinedError, prepare, uuid4 } from "./sign";
import type { NewEvent } from "./types";

export interface Queued {
  id: string;
  draft: NewEvent;
  hub: string; // the hub it was meant for
  queuedAt: string;
  tries: number;
  refused?: string; // the hub said no (not a network problem): shown, never retried
}

export type SendResult = { state: "sent"; hub: string; signed: boolean } | { state: "queued"; id: string };

const KEY = "uc-outbox";
const CHANGED = "uc-outbox-changed";
const TIMEOUT_MS = 6000;

class Unreachable extends Error {}

export function loadOutbox(): Queued[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Queued[]) : [];
  } catch {
    return [];
  }
}

function save(list: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

const update = (id: string, change: Partial<Queued> | null) =>
  save(loadOutbox().flatMap((q) => (q.id !== id ? [q] : change ? [{ ...q, ...change }] : [])));

export const discard = (id: string) => update(id, null);

/** A request that fails to connect or takes too long is a network problem; anything the hub answered isn't. */
function isNetwork(err: unknown): boolean {
  return err instanceof Unreachable || err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
}

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Unreachable("timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** POST an event. Ok, or "already there" (a duplicate id), counts as delivered. */
async function post(base: string, event: NewEvent): Promise<{ delivered: true; hub: string } | { delivered: false; refused: string }> {
  const res = await withTimeout(fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }));
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { delivered: true, hub: String(body.hub_id ?? event.hub_id ?? "") };
  const detail = String(body.detail ?? res.status);
  if (/duplicate id/.test(detail)) return { delivered: true, hub: String(event.hub_id ?? "") };
  return { delivered: false, refused: detail };
}

/**
 * Send a report now, or keep it in the outbox if the hub can't be reached. Throws, as before,
 * when the hub answers and refuses (NotJoinedError, "Hub returned 403: ...").
 */
export async function sendOrQueue(event: NewEvent, base: string = hubUrl()): Promise<SendResult> {
  const draft: NewEvent = { ...event, id: event.id ?? uuid4() };
  try {
    const { event: ready, signed } = await withTimeout(prepare(draft, base));
    const r = await post(base, ready);
    if (!r.delivered) throw new Error(`Hub returned 403: ${r.refused}`);
    return { state: "sent", hub: r.hub, signed };
  } catch (err) {
    if (!isNetwork(err)) throw err;
    const now = new Date().toISOString();
    const queued: Queued = {
      id: draft.id!, hub: base, queuedAt: now, tries: 1,
      draft: { ...draft, payload: { ...(draft.payload ?? {}), written_at: now } },
    };
    save([...loadOutbox().filter((q) => q.id !== queued.id), queued]);
    return { state: "queued", id: queued.id };
  }
}

let flushing = false;

/** Try to send everything waiting, oldest first. Stops at the first network failure. Returns how many went. */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const q of loadOutbox()) {
      if (q.refused) continue;
      try {
        const { event } = await withTimeout(prepare(q.draft, q.hub));
        const r = await post(q.hub, event);
        if (r.delivered) {
          update(q.id, null);
          sent++;
        } else {
          update(q.id, { refused: r.refused });
        }
      } catch (err) {
        if (err instanceof NotJoinedError) {
          update(q.id, { refused: "this phone isn't on the hub's roster yet" });
          continue;
        }
        update(q.id, { tries: q.tries + 1 });
        if (isNetwork(err)) break; // still no hub: try again later
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export const OUTBOX_CHANGED = CHANGED;
