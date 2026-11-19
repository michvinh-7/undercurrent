// Phone signing and cell messages (lib/sign.ts, lib/cell.ts).
//   cd web && node --import ./lib/node-ts-resolve.mjs --test lib/lib.test.mjs
// The cross-language tests run hub/.venv/bin/python, so a JS-signed event is checked by
// the hub's own crypto.verify, not by JS checking itself. They skip if the venv is missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import nacl from "tweetnacl";
import { identityFromSeed, signEvent, verifyEvent, prepareWith, NotJoinedError, uuid4, b64 } from "./sign.ts";
import { encrypt, decrypt, newCellKey, inviteLink, keyFromHash, isCellPayload, keyTag } from "./cell.ts";

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../hub");
const PY = path.join(HUB, ".venv/bin/python");
const havePy = existsSync(PY);

const me = identityFromSeed(new Uint8Array(32).fill(7));
const report = {
  type: "hazard", level: 34, author: "anon-1f2e",
  payload: { severity: "high", kind: "flooding", note: "Wasser über Pumpwell St — 2 people, “quotes”, emoji 🌊", location: "Pumpwell St", nested: { z: 1, a: [3, { y: true, b: null }] } },
};

function pyVerify(events) {
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(HUB)})
from app import crypto
print(json.dumps([crypto.verify(e) for e in json.load(sys.stdin)]))`;
  return JSON.parse(execFileSync(PY, ["-c", code], { input: JSON.stringify(events) }).toString());
}

test("a JS-signed report verifies in Python, byte for byte; any edit breaks it", { skip: !havePy && "no hub/.venv" }, () => {
  const signed = signEvent(report, "hub-L34", me);
  const edited = { ...signed, payload: { ...signed.payload, severity: "low" } };
  const moved = { ...signed, hub_id: "hub-L12" };
  const unsignedSource = { ...signEvent({ ...report, source: "resident" }, "hub-L34", me) };
  assert.deepEqual(pyVerify([signed, edited, moved, unsignedSource]), [true, false, false, true]);
  assert.equal(verifyEvent(signed), true);
  assert.equal(verifyEvent(edited), false);
});

test("Python-signed events verify in JS (same seed gives the same key on both sides)", { skip: !havePy && "no hub/.venv" }, () => {
  const seed = b64(new Uint8Array(32).fill(7));
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(HUB)})
from app import crypto
e = json.loads(sys.stdin.read())
print(json.dumps(crypto.sign(e, crypto.key_from_b64(${JSON.stringify(seed)}))))`;
  const fields = { ...report, id: uuid4(), created_at: new Date().toISOString(), hub_id: "hub-L34" };
  const signed = JSON.parse(execFileSync(PY, ["-c", code], { input: JSON.stringify(fields) }).toString());
  assert.equal(signed.author_pub, me.pub);
  assert.equal(verifyEvent(signed), true);
  assert.equal(signed.sig, signEvent(fields, "hub-L34", me).sig); // Ed25519 is deterministic
});

test("signEvent fills id, created_at, hub_id and author_pub; keeps a given id and time", () => {
  const s = signEvent(report, "hub-L12", me, new Date("2026-11-19T12:00:00.000Z"));
  assert.match(s.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(s.created_at, "2026-11-19T12:00:00.000Z");
  assert.equal(s.hub_id, "hub-L12");
  assert.equal(s.author_pub, me.pub);
  const again = signEvent({ ...report, id: s.id, created_at: s.created_at }, "hub-L12", me);
  assert.equal(again.sig, s.sig);
  assert.notEqual(uuid4(), uuid4());
});

test("prepare: signs when on the roster, unsigned when not and allowed, refuses when required", () => {
  const hub = (members, requireSigned) => ({ hubId: "hub-L34", requireSigned, members: new Set(members) });
  const a = prepareWith(report, hub([me.pub], true), me);
  assert.equal(a.signed, true);
  assert.equal(verifyEvent(a.event), true);
  const b = prepareWith(report, hub([], false), me);
  assert.deepEqual(b, { event: report, signed: false });
  assert.throws(() => prepareWith(report, hub([], true), me), (err) => err instanceof NotJoinedError && err.pub === me.pub);
});

test("cell messages: members read them, a wrong key or an edit gets null", () => {
  const key = newCellKey();
  const p = encrypt("Meet at the L27 east stairwell, 0300. Bring filters — ünïcode ok", key);
  assert.ok(isCellPayload(p));
  assert.equal(decrypt(p, key), "Meet at the L27 east stairwell, 0300. Bring filters — ünïcode ok");
  assert.equal(decrypt(p, newCellKey()), null);
  const bytes = Uint8Array.from(atob(p.ciphertext), (c) => c.charCodeAt(0));
  bytes[0] ^= 1;
  assert.equal(decrypt({ ...p, ciphertext: b64(bytes) }, key), null);
  assert.equal(decrypt({ note: "plain" }, key), null);
  assert.ok(!JSON.stringify(p).includes("stairwell"));
  assert.notEqual(encrypt("same", key).nonce, encrypt("same", key).nonce);
});

test("invite link round trip; junk hashes give null", () => {
  const key = newCellKey();
  const link = inviteLink(key, "http://192.168.1.20:3000");
  assert.ok(link.startsWith("http://192.168.1.20:3000/cell#k="));
  assert.deepEqual(keyFromHash(new URL(link).hash), key);
  assert.equal(keyFromHash(""), null);
  assert.equal(keyFromHash("#k=short"), null);
  assert.equal(keyFromHash("#k=%%%"), null);
  assert.equal(keyTag(key).length, 6);
});

test("a signed cell message passes the hub's checks over HTTP", { skip: !havePy && "no hub/.venv" }, async () => {
  // A real hub process on a free port, with this phone on the roster and signing required.
  const net = await import("node:net");
  const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "uc-web-"));
  writeFileSync(path.join(dir, "roster.json"), JSON.stringify([{ pub: me.pub, role: "member" }]));
  const proc = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"], {
    cwd: HUB, stdio: "ignore",
    env: { ...process.env, HUB_ID: "hub-L34", HUB_DB: path.join(dir, "hub.db"), HUB_PEERS: "", REQUIRE_SIGNED: "1", ROSTER_FILE: path.join(dir, "roster.json"), TRIAGE_ON_INGEST: "0" },
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const key = newCellKey();
    const msg = signEvent({ type: "case", level: 27, author: "anon-2c91", payload: encrypt("Bring the spare filters.", key) }, "hub-L34", me);
    const res = await fetch(`${base}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
    assert.equal(res.status, 201, await res.clone().text());
    const stored = await res.json();
    assert.equal(decrypt(stored.payload, key), "Bring the spare filters.");
    const phone = signEvent(report, "hub-L34", me);
    assert.equal((await fetch(`${base}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(phone) })).status, 201);
    const stranger = signEvent(report, "hub-L34", identityFromSeed(nacl.randomBytes(32)));
    const refused = await fetch(`${base}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(stranger) });
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).detail, /unknown key/);
  } finally {
    proc.kill();
  }
});
