// Cell messages: encrypted so only members of the cell can read them (Alanna's workstream;
// written by Michael while she's out). Demo beat 5: the Directorate sniffs the channel and
// sees ciphertext; a member's phone opens it.
//
// Payload on the wire (what /truth, /dashboard and the Hollow map already read):
//   { enc: true, nonce: <base64 24 bytes>, ciphertext: <base64> }
// It's tweetnacl secretbox (XSalsa20-Poly1305) under the cell's shared 32-byte key, over
// the UTF-8 JSON {"text": "..."}. The event around it is ordinary and signed like any
// report (lib/sign.ts), so hubs check and relay it without being able to read it. What
// stays visible, by design and stated in the README: who sent it, when, and the level.
//
// The key travels in person: a member's phone shows an invite QR holding a link
// <origin>/cell#k=<base64 key>. The part after # never leaves the phone that opens it
// (browsers don't send it to the server), so the web server and the hubs never see it.
// Anyone who sees that QR can read the cell, which is why it's shown face to face.
//
// Event type: "case", to match the demo cell message /truth has shown so far. The
// pages filter on payload.enc, not on the type. Relative imports only (node --test).

import nacl from "tweetnacl";
import { b64, fromB64 } from "./sign";

export interface CellPayload {
  enc: true;
  nonce: string;
  ciphertext: string;
}

export const CELL_EVENT_TYPE = "case" as const;

export const isCellPayload = (p: unknown): p is CellPayload =>
  !!p && typeof p === "object" && (p as CellPayload).enc === true &&
  typeof (p as CellPayload).nonce === "string" && typeof (p as CellPayload).ciphertext === "string";

export const newCellKey = () => nacl.randomBytes(nacl.secretbox.keyLength);

export function encrypt(text: string, key: Uint8Array): CellPayload {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(new TextEncoder().encode(JSON.stringify({ text })), nonce, key);
  return { enc: true, nonce: b64(nonce), ciphertext: b64(box) };
}

/** The message text, or null if this key can't open it (another cell, or tampered). */
export function decrypt(payload: unknown, key: Uint8Array): string | null {
  if (!isCellPayload(payload)) return null;
  try {
    const opened = nacl.secretbox.open(fromB64(payload.ciphertext), fromB64(payload.nonce), key);
    if (!opened) return null;
    const body = JSON.parse(new TextDecoder().decode(opened));
    return typeof body?.text === "string" ? body.text : null;
  } catch {
    return null;
  }
}

/** A short public tag for a key, so two members can check they hold the same one. Not secret-revealing. */
export function keyTag(key: Uint8Array): string {
  return Array.from(nacl.hash(key).slice(0, 3), (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// ---------------------------------------------------------------- the invite link

/** The invite: the cell page plus the key in the #fragment (never sent to any server).
 *  `hub`, when given, rides along as ?hub= so the new phone posts to the right hub. */
export function inviteLink(key: Uint8Array, origin: string, hub?: string): string {
  const query = hub ? `?hub=${encodeURIComponent(hub)}` : "";
  return `${origin}/cell${query}#k=${encodeURIComponent(b64(key))}`;
}

/** The key from a location.hash like "#k=...", or null. */
export function keyFromHash(hash: string): Uint8Array | null {
  const m = /(?:^#|&)k=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    const key = fromB64(decodeURIComponent(m[1]));
    return key.length === nacl.secretbox.keyLength ? key : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- kept on the phone

const CELL_KEY = "uc-cell-key";
let memoryKey: Uint8Array | null = null;

export function loadCellKey(): Uint8Array | null {
  try {
    const s = localStorage.getItem(CELL_KEY);
    if (s) {
      const k = fromB64(s);
      if (k.length === nacl.secretbox.keyLength) return k;
    }
  } catch {}
  return memoryKey;
}

export function saveCellKey(key: Uint8Array | null) {
  memoryKey = key;
  try {
    if (key) localStorage.setItem(CELL_KEY, b64(key));
    else localStorage.removeItem(CELL_KEY);
  } catch {}
}
