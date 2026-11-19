// Phone keys and signing (Alanna's workstream; written by Michael while she's out).
//
// A phone makes an Ed25519 keypair on its first visit and keeps the 32-byte seed in
// localStorage. Its public key is its identity: an operator adds it to the roster in
// person (the /join page shows it as a QR code). Every report is then signed over
// canonicalBytes, which match hub/app/crypto.canonical_bytes byte for byte.
//
// When to sign (prepare()): a hub refuses a signed event whose key isn't on its roster
// ("unknown key"), even with REQUIRE_SIGNED=0. So a phone signs once its key is on the
// roster, posts unsigned while it isn't and the hub still allows that (the old behaviour,
// shown as "not verified"), and stops with NotJoinedError when the hub requires signing.
//
// The seed is the same format crypto.key_from_b64() loads, so a phone's key can be
// exported to the Python side if needed. Relative imports only, so node --test can load
// it (see lib/node-ts-resolve.mjs).

import nacl from "tweetnacl";
import { canonicalBytes } from "./canonical";
import type { NewEvent } from "./types";

export const b64 = (u: Uint8Array) => {
  let s = "";
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
};
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Identity {
  /** Public key, base64. What goes on the roster and in author_pub. */
  pub: string;
  secretKey: Uint8Array;
}

const SEED_KEY = "uc-key";
let memorySeed: Uint8Array | null = null; // when storage is blocked (private mode)

export function identityFromSeed(seed: Uint8Array): Identity {
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { pub: b64(pair.publicKey), secretKey: pair.secretKey };
}

/** This phone's identity, made on first call and kept in the browser. Browser only. */
export function loadIdentity(): Identity {
  let seed: Uint8Array | null = null;
  try {
    const stored = localStorage.getItem(SEED_KEY);
    if (stored) seed = fromB64(stored);
  } catch {}
  if (!seed || seed.length !== 32) seed = memorySeed;
  if (!seed) {
    seed = nacl.randomBytes(32);
    try {
      localStorage.setItem(SEED_KEY, b64(seed));
    } catch {}
    memorySeed = seed;
  }
  return identityFromSeed(seed);
}

/**
 * A random UUID v4. Not crypto.randomUUID(): that only exists in secure contexts, and a
 * phone reaches the hub over plain http://<laptop-ip>:3000.
 */
export function uuid4(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Fill id, created_at, hub_id and author_pub, then sign. The hub checks it doesn't change. */
export function signEvent(event: NewEvent, hubId: string, me: Identity, now = new Date()): NewEvent {
  const filled: NewEvent = {
    ...event,
    id: event.id ?? uuid4(),
    created_at: event.created_at ?? now.toISOString(),
    hub_id: hubId,
    author_pub: me.pub,
  };
  delete filled.sig;
  const sig = nacl.sign.detached(canonicalBytes(filled as Record<string, unknown>), me.secretKey);
  return { ...filled, sig: b64(sig) };
}

/** True if event.sig is a valid signature by event.author_pub. For tests and the cell page. */
export function verifyEvent(event: Record<string, unknown>): boolean {
  try {
    return nacl.sign.detached.verify(
      canonicalBytes(event),
      fromB64(String(event.sig)),
      fromB64(String(event.author_pub)),
    );
  } catch {
    return false;
  }
}

/** The hub asks for signing, and this phone's key isn't on its roster yet. */
export class NotJoinedError extends Error {
  pub: string;
  constructor(pub: string) {
    super("This phone isn't on the hub's roster yet. Show your join code (/join) to an operator.");
    this.pub = pub;
  }
}

export interface HubSigningInfo {
  hubId: string;
  requireSigned: boolean;
  members: Set<string>;
}

/** What the hub at `base` needs to know to decide how to send: GET /health and GET /roster. */
export async function hubSigningInfo(base: string): Promise<HubSigningInfo> {
  const [health, roster] = await Promise.all(
    [`${base}/health`, `${base}/roster`].map(async (url) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Hub returned ${res.status}`);
      return res.json();
    }),
  );
  return {
    hubId: health.hub_id,
    requireSigned: !!roster.require_signed,
    members: new Set((roster.members ?? []).map((m: { pub: string }) => m.pub)),
  };
}

export type Prepared = { event: NewEvent; signed: boolean };

/** Sign if this key is on the roster; unsigned if not and the hub allows it; else NotJoinedError. */
export function prepareWith(event: NewEvent, hub: HubSigningInfo, me: Identity, now?: Date): Prepared {
  if (hub.members.has(me.pub)) return { event: signEvent(event, hub.hubId, me, now), signed: true };
  if (!hub.requireSigned) return { event, signed: false };
  throw new NotJoinedError(me.pub);
}

export async function prepare(event: NewEvent, base: string, me: Identity = loadIdentity()): Promise<Prepared> {
  return prepareWith(event, await hubSigningInfo(base), me);
}
