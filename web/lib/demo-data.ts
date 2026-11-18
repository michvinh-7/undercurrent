// Demo data for when no hub answers (e.g. the hosted showcase). Every screen that shows it
// labels it "DEMO DATA". Never mixed with live events: the hook uses one or the other.

import type { RejectedEvent, RosterStatus, LinkStatus } from "./hub";
import type { HollowEvent } from "./types";

const CANARY_PUB = "Y2FuYXJ5LTM0LWRlbW8ta2V5LW5vdC1yZWFsLTAwMDAwMA==";
const MEMBER_PUB = "bWVtYmVyLWFub24tN2YzYS1kZW1vLWtleS0wMDAwMDAwMA==";
const MEMBER2_PUB = "bWVtYmVyLWFub24tMmM5MS1kZW1vLWtleS0wMDAwMDAwMA==";

const ago = (now: number, s: number) => new Date(now - s * 1000).toISOString();
const fakeHash = (n: number) => (n * 2654435761).toString(16).padStart(8, "0").repeat(8).slice(0, 64);

export function demoEvents(now = Date.now()): HollowEvent[] {
  const base = (i: number, e: Partial<HollowEvent>): HollowEvent => ({
    id: `demo-${i}`,
    type: "hazard",
    hub_id: "hub-L34",
    level: 34,
    created_at: ago(now, 60),
    author: "anon-7f3a",
    priority: 0.5,
    payload: {},
    prev_hash: fakeHash(i - 1),
    hash: fakeHash(i),
    author_pub: MEMBER_PUB,
    sig: "ZGVtby1zaWduYXR1cmU=",
    source: "resident",
    device_id: null,
    ...e,
  });
  return [
    base(1, {
      type: "hazard", level: 34, created_at: ago(now, 48), author: "canary-34", priority: 0.96,
      payload: { kind: "flooding", severity: "high", location: "Pump room", note: "Water probe past threshold for 3 s" },
      author_pub: CANARY_PUB, source: "sensor", device_id: "canary-34",
    }),
    base(20, {
      type: "hazard", level: 34, created_at: ago(now, 1200), priority: 0.6,
      payload: { kind: "bad_water", severity: "medium", location: "Pumpwell St", note: "Tap water brown and smells of metal" },
    }),
    base(21, {
      type: "hazard", level: 34, created_at: ago(now, 2100), priority: 0.55, author: "anon-2c91", author_pub: MEMBER2_PUB,
      payload: { kind: "bad_water", severity: "medium", location: "Pumpwell Street, near the school", note: "Kids sick after drinking from the tap" },
    }),
    base(22, {
      type: "hazard", level: 34, created_at: ago(now, 3300), priority: 0.5,
      payload: { kind: "bad_water", severity: "low", location: "pumpwell st", note: "Cloudy water" },
    }),
    base(23, {
      type: "case", level: 34, created_at: ago(now, 1500), priority: 0.66,
      payload: { symptoms: ["coughing", "short of breath"], people_affected: 4, raw_text: "my whole family coughing, hard to breathe at night" },
    }),
    base(24, {
      type: "case", level: 34, created_at: ago(now, 4000), priority: 0.6, author: "anon-2c91", author_pub: MEMBER2_PUB,
      payload: { symptoms: ["chest pain", "coughing"], people_affected: 2 },
    }),
    base(2, {
      type: "checkin", level: 34, created_at: ago(now, 95), priority: 0.93,
      payload: { status: "need_help", name: "Ines Varga", note: "Stuck behind the east bulkhead, water rising" },
    }),
    base(3, {
      type: "case", level: 27, hub_id: "hub-L12", created_at: ago(now, 300), priority: 0.71, author: "anon-2c91",
      author_pub: MEMBER2_PUB,
      payload: { symptoms: ["fever", "coughing"], people_affected: 3, raw_text: "three kids on 27 with fever since last night" },
    }),
    base(4, {
      type: "missing_person", level: 27, hub_id: "hub-L12", created_at: ago(now, 640), priority: 0.62, author: "anon-2c91",
      author_pub: MEMBER2_PUB,
      payload: { name: "Teo Marsh", last_seen_level: 27, description: "Grey jacket, last seen at the east stairwell" },
    }),
    base(5, {
      type: "case", level: 34, created_at: ago(now, 410), priority: 0.4,
      payload: { enc: true, nonce: "Vm8yY2VydGFpbnR5LW5vbmNlLTI0Yg==", ciphertext: "7cA1bN4fXk2sQe9LwZr0Ty5uIo3pAs8dFg6hJk1lZx4cVb7nMm2QwErTy0UiOp9AsDfGh==" },
    }),
    base(6, {
      type: "checkin", level: 12, hub_id: "hub-L12", created_at: ago(now, 900), priority: 0.12, author: "anon-2c91",
      author_pub: MEMBER2_PUB, payload: { status: "ok", name: "Mara Okafor", note: "Safe at the L12 relay" },
    }),
    base(7, {
      type: "hazard", level: 12, hub_id: "hub-L12", created_at: ago(now, 1500), priority: 0.35, author: "anon-2c91",
      author_pub: MEMBER2_PUB, payload: { kind: "blackout", severity: "low", location: "North relay corridor" },
    }),
    base(8, {
      type: "checkin", level: 38, created_at: ago(now, 1900), priority: 0.2, author: "anon-9be0",
      author_pub: null, sig: null, payload: { status: "ok", note: "Unsigned report from an old phone" },
    }),
  ];
}

export function demoRejected(now = Date.now()): { total: number; rejected: RejectedEvent[] } {
  const r = (seq: number, s: number, reason: string, via: "post" | "sync", event: Partial<HollowEvent>): RejectedEvent => ({
    seq, received_at: ago(now, s), reason, via, event,
  });
  return {
    total: 3,
    rejected: [
      r(3, 14, "unknown key", "post", { type: "hazard", level: 34, author: "directorate", payload: { kind: "other", severity: "low", note: "All clear, level 34" } }),
      r(2, 180, "bad signature", "sync", { type: "hazard", level: 12, payload: { kind: "flooding", severity: "low" } }),
      r(1, 480, "replay: duplicate id", "post", { type: "checkin", level: 8 }),
    ],
  };
}

export const demoRoster: RosterStatus = {
  require_signed: false,
  members: [
    { pub: CANARY_PUB, role: "member" },
    { pub: MEMBER_PUB, role: "member" },
    { pub: MEMBER2_PUB, role: "operator" },
  ],
};

export const demoLink: LinkStatus = { bandwidth_bps: null, cut: false, queued: 0, queued_bytes: 0 };
