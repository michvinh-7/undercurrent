// Mirrors shared/schemas/event.schema.json. Change both together.

export type EventType = "checkin" | "hazard" | "case" | "missing_person" | "roster";
export type EventSource = "resident" | "sensor";

export interface HollowEvent {
  id: string;
  type: EventType;
  hub_id: string;
  level: number;
  created_at: string;
  author: string;
  priority: number | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  author_pub?: string | null; // signer's Ed25519 public key, base64
  sig?: string | null; // Ed25519 signature over SIGNED_FIELDS, base64
  source?: EventSource | null; // null means resident
  device_id?: string | null; // Canary box id, sensor events only
}

/**
 * What a signature covers, in hub/app/models.py order. To sign: take these fields,
 * drop null/undefined ones, sort keys at every depth, JSON.stringify with no spaces,
 * UTF-8 encode, then nacl.sign.detached. Must match hub/app/crypto.canonical_bytes
 * byte for byte. priority is never signed.
 */
export const SIGNED_FIELDS = [
  "id", "type", "hub_id", "level", "created_at", "author", "payload",
  "author_pub", "source", "device_id",
] as const;

/** Unsigned: type, level, author, payload. Signed: the signer also sets id, created_at, hub_id, author_pub, sig. */
export type NewEvent = Pick<HollowEvent, "type" | "level" | "author" | "payload"> &
  Partial<Pick<HollowEvent, "id" | "created_at" | "hub_id" | "author_pub" | "sig" | "source" | "device_id">> & {
    priority?: number | null;
  };
