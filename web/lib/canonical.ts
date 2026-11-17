// The bytes a signature covers. Must match hub/app/crypto.canonical_bytes byte for byte.
// Sign with tweetnacl: nacl.sign.detached(canonicalBytes(event), secretKey), then base64.

import { SIGNED_FIELDS } from "./types";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** SIGNED_FIELDS that aren't null/undefined, keys sorted at every depth, compact JSON, UTF-8. */
export function canonicalBytes(event: Record<string, unknown>): Uint8Array {
  const content: Record<string, unknown> = {};
  for (const k of SIGNED_FIELDS) {
    if (event[k] !== null && event[k] !== undefined) content[k] = event[k];
  }
  return new TextEncoder().encode(JSON.stringify(sortKeys(content)));
}
