// The phone outbox (lib/outbox.ts) against a fake hub: nothing lost while the hub is away,
// sent at most once, signed fresh when it finally goes, and a refusal never dropped silently.
//   cd web && node --import ./lib/node-ts-resolve.mjs --test lib/outbox.test.mjs

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { b64, identityFromSeed, verifyEvent } from "./sign.ts";
import { flushOutbox, loadOutbox, sendOrQueue } from "./outbox.ts";

const BASE = "http://hub.test:8001";
const seed = new Uint8Array(32).fill(9);
const me = identityFromSeed(seed);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let hub;
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
globalThis.fetch = async (url, opts = {}) => {
  if (!hub.up) throw new TypeError("Failed to fetch");
  const path = new URL(url).pathname;
  if (path === "/health") return reply(200, { hub_id: "hub-L34" });
  if (path === "/roster") return reply(200, { require_signed: true, members: [...hub.members].map((pub) => ({ pub })) });
  if (path === "/events" && opts.method === "POST") {
    const e = JSON.parse(opts.body);
    hub.posts++;
    if (!verifyEvent(e)) return reply(403, { detail: "bad signature" });
    if (Math.abs(Date.now() - Date.parse(e.created_at)) > 300_000) return reply(403, { detail: "replay: outside the time window" });
    if (hub.events.has(e.id)) return reply(403, { detail: "replay: duplicate id" });
    hub.events.set(e.id, e);
    return reply(201, { ...e });
  }
  return reply(404, {});
};

const sos = () => ({ type: "checkin", level: 34, author: "anon-1", payload: { status: "need_help", note: "water rising" } });

beforeEach(() => {
  store.clear();
  store.set("uc-key", b64(seed));
  hub = { up: true, members: new Set([me.pub]), events: new Map(), posts: 0 };
});

test("with the hub up, a report sends at once and nothing waits", async () => {
  const r = await sendOrQueue(sos(), BASE);
  assert.equal(r.state, "sent");
  assert.equal(hub.events.size, 1);
  assert.deepEqual(loadOutbox(), []);
});

test("with no hub, it waits on the phone, then sends itself, signed, when the hub is back", async () => {
  hub.up = false;
  const r = await sendOrQueue(sos(), BASE);
  assert.equal(r.state, "queued");
  const [q] = loadOutbox();
  assert.ok(q.draft.payload.written_at && q.id === r.id && !q.draft.sig);

  assert.equal(await flushOutbox(), 0); // still no hub: stays, one more try counted
  assert.equal(loadOutbox()[0].tries, 2);

  hub.up = true;
  assert.equal(await flushOutbox(), 1);
  assert.deepEqual(loadOutbox(), []);
  const stored = hub.events.get(r.id);
  assert.ok(verifyEvent(stored) && stored.author_pub === me.pub && stored.hub_id === "hub-L34");
  assert.equal(stored.payload.written_at, q.draft.payload.written_at); // when it was written, under the signature
  assert.ok(Date.parse(stored.created_at) >= Date.parse(q.draft.payload.written_at)); // signed fresh, so it isn't stale
});

test("a send that got through but whose answer was lost is not sent twice", async () => {
  hub.up = false;
  const r = await sendOrQueue(sos(), BASE);
  hub.up = true;
  hub.events.set(r.id, { id: r.id }); // it reached the hub on an earlier try
  assert.equal(await flushOutbox(), 1); // "replay: duplicate id" counts as delivered
  assert.deepEqual(loadOutbox(), []);
  assert.equal(hub.events.size, 1);
});

test("a report the hub refuses stays on the phone, marked, and isn't retried", async () => {
  hub.up = false;
  await sendOrQueue(sos(), BASE);
  hub.up = true;
  hub.members.clear(); // the phone was removed from the roster meanwhile
  assert.equal(await flushOutbox(), 0);
  const [q] = loadOutbox();
  assert.match(q.refused, /roster/);
  const before = hub.posts;
  await flushOutbox();
  assert.equal(hub.posts, before);
});

test("waiting reports go oldest first, and a refusal by the hub on send throws as before", async () => {
  hub.up = false;
  const a = await sendOrQueue({ ...sos(), payload: { status: "need_help", note: "first" } }, BASE);
  const b = await sendOrQueue({ ...sos(), payload: { status: "need_help", note: "second" } }, BASE);
  hub.up = true;
  assert.equal(await flushOutbox(), 2);
  assert.deepEqual([...hub.events.keys()], [a.id, b.id]);
  hub.members.clear();
  await assert.rejects(sendOrQueue(sos(), BASE), /roster/);
});
