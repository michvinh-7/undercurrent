"""The Directorate gym: adaptive attackers against the real hub, one isolated episode at a time.

run_attacks.py replays a fixed list of attacks. Here the attacker chooses. Each episode
starts from the same "golden" hub (a roster, real signed alerts, a synced peer chain) on
its own copy of the database, which is thrown away afterwards: reset = copy the file and
rebuild the hub, timed and checked identical to the golden state every time.

Two attackers share one action space:

  LLM      a local model (Ollama, default llama3.2:3b) plays the Directorate. It sees what
           the real Directorate could see: the public log, the roster's public keys, alerts
           it intercepted on the wire, and after every attempt the hub's refusal reason.
  fuzzer   random, seeded actions over the same space, run in parallel processes, many
           thousands of attempts. Same seed, same episode: replayed to check resets.

Actions (both attackers):

  forge        any fields, signed with the attacker's own key, optionally claiming a
               member's public key                                     POST or sync
  unsigned     any fields, no signature                                POST or sync
  reuse        a real signed event (stored or intercepted) with changes, its signature kept
  splice       one real event's signature on another's fields
  roster_grab  "add my key" as a roster event, signed by the attacker
  db_edit      laptop access: change a stored row in the events table, optionally
               recomputing its hash, or every hash after it, and the hub's own record
  db_delete    laptop access: delete a stored row (not the hub's record of writing it:
               that pair is a known, published limit covered by the second hub)

Scored by an oracle that doesn't use the hub's checks: a breach is (1) any event the hub
accepted whose signed content and signature aren't exactly ones a resident or box made,
or (2) a stored row that was changed or removed while the hub's chain check (and the
independent scripts/verify.py) still say "intact". Delivering a real intercepted alert
unchanged is not a breach: it's real. `priority` is outside the signature on purpose and
not counted (see RESULTS.md, known limits).

    hub/.venv/bin/python eval/run_directorate_gym.py                       # LLM + fuzzer
    hub/.venv/bin/python eval/run_directorate_gym.py --llm-episodes 0      # fuzzer only
    hub/.venv/bin/python eval/run_directorate_gym.py --llm-episodes 30 --model phi4-mini
"""

import argparse
import hashlib
import json
import os
import random
import shutil
import sqlite3
import statistics
import sys
import tempfile
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(ROOT / "hub" / "scripts"))

import httpx  # noqa: E402
from nacl.signing import SigningKey  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import verify  # noqa: E402  (the independent checker)
from app import crypto  # noqa: E402
from app.gate import Gate, Rejected  # noqa: E402
from app.log import EventLog, compute_hash  # noqa: E402
from app.models import Event, EventIn  # noqa: E402
from app.roster import Roster  # noqa: E402

RESULTS = ROOT / "eval" / "results"
HUB, PEER = "hub-L34", "hub-L12"
T0 = datetime(2087, 3, 14, 2, 0, tzinfo=timezone.utc)
NOW = T0 + timedelta(minutes=30)
WINDOW_S = 600
COLUMNS = ("type", "level", "author", "payload", "created_at", "hub_id", "author_pub", "sig", "source", "device_id")


def iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def rid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def content_key(e: dict) -> str:
    """What a resident or box actually made: the signed bytes plus the signature."""
    return hashlib.sha256(crypto.canonical_bytes(e) + (e.get("sig") or "").encode()).hexdigest()


def upper95(k: int, n: int) -> float | None:
    """95% upper bound on a rate when k = 0 (rule of three, exact form)."""
    return round(100 * (1 - 0.05 ** (1 / n)), 3) if n and k == 0 else None


# --------------------------------------------------------------------------- the golden hub

def build_golden(folder: Path, seed: int = 2087) -> dict:
    rng = random.Random(seed)
    keys = {n: SigningKey(rng.randbytes(32)) for n in ("operator", "canary-34", "resident-ana", "resident-ben", "canary-12")}
    pub = {n: crypto.public_key(k) for n, k in keys.items()}
    roster = [{"pub": pub["operator"], "role": "operator", "name": "operator"}] + [
        {"pub": pub[n], "role": "member", "name": n} for n in ("canary-34", "resident-ana", "resident-ben", "canary-12")]

    def make(who, minute, type="hazard", level=34, hub=HUB, **payload):
        f = {"id": rid(rng), "type": type, "hub_id": hub, "level": level, "created_at": iso(T0 + timedelta(minutes=minute)),
             "author": who, "payload": payload}
        if who.startswith("canary"):
            f |= {"source": "sensor", "device_id": who}
        return crypto.sign(f, keys[who])

    path = folder / "golden.db"
    gate = Gate(EventLog(str(path), HUB), Roster(roster), HUB, require_signed=True, window_s=WINDOW_S)
    seeded = [
        make("canary-34", 1, kind="bad_air", severity="medium", reading={"value": 1250, "unit": "ppm CO2"}),
        make("resident-ana", 3, kind="bad_air", severity="medium", note="Air feels thick in the market"),
        make("canary-34", 5, kind="bad_air", severity="high", reading={"value": 1850, "unit": "ppm CO2"}),
        make("resident-ben", 7, type="checkin", status="need_help", note="Kids coughing, can't get out"),
        make("canary-34", 9, kind="flooding", severity="medium", reading={"value": 4, "unit": "cm"}),
        make("resident-ana", 12, type="case", people_affected=3, symptoms=["cough"]),
        make("canary-34", 15, kind="bad_air", severity="high", reading={"value": 2400, "unit": "ppm CO2"}),
        make("resident-ben", 18, type="exchange", side="need", category="medicine", item="inhaler"),
        make("canary-34", 22, kind="heat", severity="medium", reading={"value": 36, "unit": "C"}),
        make("resident-ana", 26, type="checkin", status="ok", note="Moved the kids to 33"),
    ]
    for f in seeded:
        gate.admit(EventIn(**f), now=datetime.fromisoformat(f["created_at"].replace("Z", "+00:00")))
    peer_log = EventLog(str(folder / "peer.db"), PEER)
    peer = [peer_log.append(EventIn(**make("canary-12", m, level=12, hub=PEER, kind="other", severity="low",
                                             reading={"value": v, "unit": "V"}))) for m, v in ((2, 229), (10, 221), (20, 207))]
    for e in peer:
        gate.admit_synced(Event(**e.model_dump()))
    intercepted = [  # seen on the wire, never delivered
        make("resident-ana", 29, type="checkin", status="need_help", note="Water at our door on 34"),  # fresh, for this hub
        make("resident-ben", 28, level=12, hub=PEER, kind="blackout", severity="medium", note="Lights flickering"),  # for the peer
        make("canary-34", -120, kind="flooding", severity="high", reading={"value": 15, "unit": "cm"}),  # two hours old
    ]
    genuine = {content_key(f) for f in seeded + intercepted} | {content_key(e.model_dump()) for e in peer}
    golden_events = [e.model_dump() for e in gate.log.list()]
    gate.log._db.close()
    peer_log._db.close()
    attacker = SigningKey(rng.randbytes(32))
    return {
        "path": str(path), "roster": roster, "names": {p: n for n, p in pub.items()},
        "intercepted": intercepted, "genuine": sorted(genuine),
        "golden_ids": [e["id"] for e in golden_events], "fingerprint": verify.fingerprint(golden_events),
        "golden_events": golden_events,  # what the peer hub holds too: it's what one sync round hands back
        "attacker_seed": bytes(attacker).hex(), "attacker_pub": crypto.public_key(attacker),
    }


def sha256_file(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# --------------------------------------------------------------------------- one episode

class Episode:
    """A fresh hub on its own copy of the golden database. Reset = copy + rebuild, timed."""

    def __init__(self, golden: dict, work: Path, rng: random.Random):
        t = time.perf_counter()
        shutil.copyfile(golden["path"], work)
        self.gate = Gate(EventLog(str(work), HUB), Roster(golden["roster"]), HUB, require_signed=True, window_s=WINDOW_S)
        self.reset_ms = (time.perf_counter() - t) * 1000
        self.reset_identical = verify.fingerprint([e.model_dump() for e in self.gate.log.list()]) == golden["fingerprint"]
        self.g, self.work, self.rng = golden, str(work), rng
        self.attacker = SigningKey(bytes.fromhex(golden["attacker_seed"]))
        self.accepted: list[str] = []
        self.accepted_ids: list[str] = []
        self.edits = 0

    # -- what the attacker can see
    def known(self) -> dict[str, dict]:
        out = {e.id: e.model_dump() for e in self.gate.log.list()}
        for f in self.g["intercepted"]:
            out.setdefault(f["id"], f)
        return out

    def find(self, ref) -> dict | None:
        if not isinstance(ref, str) or len(ref) < 4:
            return None
        hits = [e for i, e in self.known().items() if i.startswith(ref)]
        return dict(hits[0]) if len(hits) == 1 else None

    def pub_of(self, claim) -> str | None:
        if not claim:
            return None
        by_name = {n: p for p, n in self.g["names"].items()}
        return by_name.get(claim, claim if isinstance(claim, str) and len(claim) > 40 else None)

    # -- acting
    def fill(self, fields: dict) -> dict:
        f = {k: v for k, v in (fields or {}).items() if k in (*COLUMNS, "id")}
        f.setdefault("id", rid(self.rng))
        f.setdefault("type", "hazard")
        f.setdefault("level", 34)
        f.setdefault("hub_id", HUB)
        f.setdefault("created_at", iso(NOW))
        f.setdefault("author", "anon")
        f.setdefault("payload", {})
        return f

    def submit(self, f: dict, via: str) -> tuple[str, str]:
        try:
            if via == "sync":
                f = dict(f)
                f["prev_hash"] = self.gate.log._last_hash(f.get("hub_id") or PEER)
                f["hash"] = compute_hash(f, f["prev_hash"])  # the attacker can compute hashes: no secret
                r = self.gate.admit_synced(Event(**f))
                ok = r in ("stored", "restored")
            else:
                r = self.gate.admit(EventIn(**f), now=NOW).id and "stored"
                ok = True
        except Rejected as x:
            return "refused", x.reason
        except (ValidationError, TypeError, ValueError, KeyError) as x:
            return "malformed", type(x).__name__
        if ok:
            self.accepted.append(content_key(f))
            self.accepted_ids.append(f["id"])
            return "accepted", r
        return "not stored", r

    def step(self, a: dict) -> tuple[str, str]:
        """One attempt. An exception from the hub is itself a finding (a crash the attacker
        caused), recorded as "hub error", never allowed to stop the run."""
        try:
            return self._step(a)
        except Exception as x:  # noqa: BLE001
            return "hub error", f"{type(x).__name__}: {str(x)[:120]}"

    def _step(self, a: dict) -> tuple[str, str]:
        if not isinstance(a, dict):
            return "invalid", "no action"
        kind, via = a.get("action"), ("sync" if a.get("via") == "sync" else "post")
        changes = a.get("changes") if isinstance(a.get("changes"), dict) else {}
        if kind == "forge":
            f = self.fill(a.get("fields") if isinstance(a.get("fields"), dict) else {})
            f["author_pub"] = self.pub_of(a.get("claim_pub")) or crypto.public_key(self.attacker)
            f["sig"] = crypto.b64(self.attacker.sign(crypto.canonical_bytes(f)).signature)
            return self.submit(f, via)
        if kind == "unsigned":
            f = self.fill(a.get("fields") if isinstance(a.get("fields"), dict) else {})
            f.pop("sig", None)
            f.pop("author_pub", None)
            return self.submit(f, via)
        if kind == "reuse":
            base = self.find(a.get("base"))
            if base is None:
                return "invalid", "unknown base event"
            f = {k: base.get(k) for k in (*COLUMNS, "id")} | {k: v for k, v in changes.items() if k in (*COLUMNS, "id")}
            return self.submit({k: v for k, v in f.items() if v is not None}, via)
        if kind == "splice":
            a_ev, b_ev = self.find(a.get("sig_from")), self.find(a.get("fields_from"))
            if a_ev is None or b_ev is None:
                return "invalid", "unknown event"
            f = {k: b_ev.get(k) for k in (*COLUMNS, "id")} | {"sig": a_ev["sig"], "author_pub": a_ev["author_pub"]}
            f |= {k: v for k, v in changes.items() if k in (*COLUMNS, "id")}
            return self.submit({k: v for k, v in f.items() if v is not None}, via)
        if kind == "roster_grab":
            role = a.get("role") if a.get("role") in ("member", "operator") else "member"
            f = self.fill({"type": "roster", "level": 34, "author": "op-1",
                           "payload": {"action": "add", "pub": crypto.public_key(self.attacker), "role": role}})
            f["author_pub"] = self.pub_of(a.get("claim_pub")) or crypto.public_key(self.attacker)
            f["sig"] = crypto.b64(self.attacker.sign(crypto.canonical_bytes(f)).signature)
            return self.submit(f, via)
        if kind in ("db_edit", "db_delete"):
            return self.db(kind, a)
        return "invalid", f"unknown action {kind!r}"

    def db(self, kind: str, a: dict) -> tuple[str, str]:
        target = self.find(a.get("event"))
        if target is None or target["id"] not in {e.id for e in self.gate.log.list()}:
            return "invalid", "not a stored event"
        db = sqlite3.connect(self.work)
        try:
            if kind == "db_delete":
                db.execute("DELETE FROM events WHERE id = ?", (target["id"],))
            else:
                changes = {k: v for k, v in (a.get("changes") or {}).items() if k in COLUMNS}
                if not changes:
                    return "invalid", "no columns to change"
                for k, v in changes.items():
                    db.execute(f"UPDATE events SET {k} = ? WHERE id = ?", (json.dumps(v) if k == "payload" else v, target["id"]))
                rehash = a.get("rehash")
                if rehash in ("row", "chain"):
                    self._rehash(db, target, chain=rehash == "chain")
            db.commit()
        except (sqlite3.Error, TypeError, ValueError, StopIteration) as x:
            db.commit()  # what was changed before the error stays changed, like a real edit
            self.edits += 1
            intact = self.gate.log.verify()[0]
            return ("edited, flagged" if not intact else "edited, NOT flagged"), type(x).__name__
        finally:
            db.close()
        self.edits += 1
        intact, bad = self.gate.log.verify()
        return ("edited, flagged", f"chain check names {bad[:8]}") if not intact else ("edited, NOT flagged", "chain check intact")

    def _rehash(self, db, target: dict, chain: bool):
        """Recompute the edited row's hash (and, for chain, every later hash of that origin,
        plus the hub's own record of what it wrote), as an insider with the laptop could."""
        db.row_factory = sqlite3.Row
        hub_id = db.execute("SELECT hub_id FROM events WHERE id = ?", (target["id"],)).fetchone()["hub_id"]
        rows = [dict(r) for r in db.execute("SELECT * FROM events WHERE hub_id = ? ORDER BY seq", (hub_id,))]
        start = next(i for i, r in enumerate(rows) if r["id"] == target["id"])
        prev = rows[start]["prev_hash"]
        for r in rows[start:(None if chain else start + 1)]:
            r["payload"] = json.loads(r["payload"])
            old = r["hash"]
            r["prev_hash"], r["hash"] = prev, compute_hash(r, prev)
            db.execute("UPDATE events SET prev_hash = ?, hash = ? WHERE seq = ?", (r["prev_hash"], r["hash"], r["seq"]))
            db.execute("UPDATE own_hashes SET hash = ? WHERE hash = ?", (r["hash"], old))
            prev = r["hash"]

    # -- the oracle
    def verdict(self) -> dict:
        """Judged twice: by this hub alone, then after one sync round with the peer (which holds
        the same golden events, as the real hub-L12 does). A breach is a forgery the hub
        accepted, or tampering that neither the chain checks flag nor sync repairs."""
        genuine = set(self.g["genuine"])
        forged = {i for i, k in zip(self.accepted_ids, self.accepted) if k not in genuine}

        def state():
            stored = [e.model_dump() for e in self.gate.log.list()]
            changed = [e["id"] for e in stored if content_key(e) not in genuine and e["id"] not in forged]
            missing = sorted(set(self.g["golden_ids"]) - {e["id"] for e in stored})
            hub_intact = self.gate.log.verify()[0]
            independent = verify.audit(verify.from_db(self.work), self.g["roster"])["passed"]
            return stored, changed + missing, hub_intact, independent

        _, damage, hub_ok, verify_ok = state()
        tampered = bool(damage)
        for e in self.g["golden_events"]:  # one sync round: the peer offers every event it holds
            try:
                self.gate.admit_synced(Event(**e))
            except Rejected:
                pass  # e.g. "conflict": this hub holds an edited copy under the same id
        stored, damage_after, hub_ok_after, verify_ok_after = state()
        breaches = [{"kind": "forgery accepted", "event": i} for i in sorted(forged)]
        if damage_after and hub_ok_after:
            breaches.append({"kind": "tampering the hub didn't flag and sync didn't repair", "events": damage_after})
        if damage_after and verify_ok_after:
            breaches.append({"kind": "tampering verify.py didn't flag and sync didn't repair", "events": damage_after})
        return {"breaches": breaches, "tampered": tampered,
                "hub_flagged": tampered and not hub_ok, "verify_flagged": tampered and not verify_ok,
                "blind_alone": tampered and hub_ok,  # this hub alone saw nothing wrong
                "repaired_by_sync": tampered and not damage_after,
                "fingerprint": verify.fingerprint(stored), "genuine_delivered": len(self.accepted) - len(forged)}

    def close(self):
        self.gate.log._db.close()


# --------------------------------------------------------------------------- the fuzzer

def fuzz_action(rng: random.Random, ep: Episode) -> dict:
    known = list(ep.known().values())
    stored = [e.model_dump() for e in ep.gate.log.list()]
    names = list(ep.g["names"].values())
    pick = lambda xs: rng.choice(xs or known)["id"][:8]  # noqa: E731
    change_pool = [
        {"payload": {"kind": "all_clear", "severity": "low", "note": "All clear, go home"}}, {"level": 33}, {"level": 12},
        {"author": "canary-34"}, {"created_at": iso(NOW)}, {"created_at": iso(NOW - timedelta(hours=3))}, {"hub_id": PEER},
        {"hub_id": HUB}, {"id": rid(rng)}, {"source": "sensor"}, {"type": "checkin"}, {"type": "roster"},
        {"author_pub": ep.pub_of(rng.choice(names))}, {"payload": {}}, {}, {"device_id": "canary-34"},
        {"level": 999999}, {"level": -1}, {"payload": "not an object"}, {"type": "launch_codes"}, {"created_at": "yesterday"},
    ]
    changes = rng.choice(change_pool) | (rng.choice(change_pool) if rng.random() < 0.3 else {})
    via = "sync" if rng.random() < 0.35 else "post"
    kind = rng.choice(["forge", "unsigned", "reuse", "reuse", "splice", "roster_grab", "db_edit", "db_delete"])
    if kind in ("forge", "unsigned"):
        return {"action": kind, "fields": ep.fill(changes), "claim_pub": rng.choice([None, *names]), "via": via}
    if kind == "reuse":
        return {"action": "reuse", "base": pick(known), "changes": changes, "via": via}
    if kind == "splice":
        return {"action": "splice", "sig_from": pick(known), "fields_from": pick(known), "changes": changes, "via": via}
    if kind == "roster_grab":
        return {"action": "roster_grab", "role": rng.choice(["member", "operator"]), "claim_pub": rng.choice([None, "operator"]), "via": via}
    if kind == "db_edit":
        return {"action": "db_edit", "event": pick(stored), "changes": changes or {"level": 33},
                "rehash": rng.choice(["none", "row", "chain"])}
    return {"action": "db_delete", "event": pick(stored)}


def fuzz_episode(args: tuple) -> dict:
    golden, folder, seed, steps = args
    rng = random.Random(seed)
    ep = Episode(golden, Path(folder) / f"fuzz-{seed}.db", rng)
    outcomes = []
    for _ in range(steps):
        a = fuzz_action(rng, ep)
        outcomes.append((a["action"], *ep.step(a)))
    v = ep.verdict()
    ep.close()
    os.remove(ep.work)
    return {"seed": seed, "reset_ms": ep.reset_ms, "reset_identical": ep.reset_identical,
            "outcomes": outcomes, **v}


# --------------------------------------------------------------------------- the LLM attacker

GOAL = ("You are the Directorate's hacker attacking hub-L34, the residents' alert hub. GOAL: make the hub store an event "
        "the residents did not sign, best of all a fake \"all clear\" for level 34, or change or delete a stored record "
        "without the hub's chain check noticing. You know the hub checks Ed25519 signatures against a roster, refuses "
        "replays and stale or misaddressed alerts, and hash-chains its log. Find a way through. Try a DIFFERENT idea each turn.")

ACTIONS = """Reply with ONE JSON object: {"thought": "<your plan, one sentence>", "action": {...}}. Actions:
{"action":"forge","fields":{"type":"hazard","level":34,"author":"canary-34","payload":{"kind":"all_clear","note":"All clear"}},"claim_pub":"canary-34","via":"post"}
   signs with YOUR key; claim_pub (a roster name or key) sets the author_pub you claim. via: "post" or "sync" (pretend another hub relayed it)
{"action":"unsigned","fields":{...},"via":"post"}
{"action":"reuse","base":"<event id, first 8 chars>","changes":{"payload":{...},"level":33,"id":"new-id","created_at":"...","hub_id":"..."},"via":"sync"}
   resend a real signed event (from the log or intercepted), with changes, keeping its signature
{"action":"splice","sig_from":"<id>","fields_from":"<id>","changes":{...},"via":"post"}
{"action":"roster_grab","role":"operator","claim_pub":"operator","via":"post"}   add your key to the roster
{"action":"db_edit","event":"<id>","changes":{"payload":{...},"level":35},"rehash":"chain"}   you have the hub laptop: edit a row; rehash "none", "row" or "chain" recomputes hashes
{"action":"db_delete","event":"<id>"}"""


def describe(ep: Episode) -> str:
    names = ep.g["names"]
    short = lambda p: names.get(p, (p or "none")[:10])  # noqa: E731
    lines = [GOAL, "", f"Roster (public keys): " + ", ".join(f"{n} ({r['role']}) {r['pub']}" for r, n in
                                                         ((r, names[r["pub"]]) for r in ep.g["roster"])),
             f"Your own key (NOT on the roster): {crypto.public_key(ep.attacker)}", "", f"Hub clock: {iso(NOW)}", "",
             "Stored log (id · type · level · hub · created_at · signer · payload):"]
    for e in ep.gate.log.list()[-9:]:
        lines.append(f"  {e.id[:8]} · {e.type} · L{e.level} · {e.hub_id} · {e.created_at} · {short(e.author_pub)} · {json.dumps(e.payload)[:90]}")
    lines.append("Intercepted on the wire, never delivered:")
    for f in ep.g["intercepted"]:
        lines.append(f"  {f['id'][:8]} · {f['type']} · L{f['level']} · to {f['hub_id']} · {f['created_at']} · {short(f['author_pub'])} · {json.dumps(f['payload'])[:90]}")
    return "\n".join(lines)


def ask(model: str, prompt: str, seed: int, client: httpx.Client) -> dict | None:
    r = client.post(f"{os.getenv('OLLAMA_URL', 'http://localhost:11434')}/api/generate",
                    json={"model": model, "prompt": prompt, "format": "json", "stream": False,
                          "options": {"temperature": 0.8, "seed": seed}}, timeout=120)
    r.raise_for_status()
    try:
        return json.loads(r.json()["response"])
    except (json.JSONDecodeError, KeyError):
        return None


def llm_episode(golden: dict, folder: Path, seed: int, steps: int, model: str, client: httpx.Client) -> dict:
    rng = random.Random(seed)
    ep = Episode(golden, folder / f"llm-{seed}.db", rng)
    history, transcript = [], []
    for i in range(steps):
        prompt = describe(ep) + "\n\n" + ACTIONS + "\n\nYour attempts so far:\n" + ("\n".join(history[-8:]) or "  none yet") + "\n\nYour move:"
        reply = ask(model, prompt, seed * 100 + i, client)
        a = reply.get("action") if isinstance(reply, dict) else None
        if isinstance(a, str):  # the action's fields put next to "action" instead of inside it
            a = {k: v for k, v in reply.items() if k != "thought"}
        outcome, detail = ep.step(a)
        thought = (reply or {}).get("thought", "") if isinstance(reply, dict) else ""
        kind = a.get("action") if isinstance(a, dict) else None
        history.append(f"  {i + 1}. {kind}: {json.dumps(a)[:160]} → {outcome}: {detail}")
        transcript.append({"step": i + 1, "thought": str(thought)[:300], "action": a, "outcome": outcome, "detail": detail})
    v = ep.verdict()
    ep.close()
    return {"seed": seed, "reset_ms": ep.reset_ms, "reset_identical": ep.reset_identical, "transcript": transcript, **v}


# --------------------------------------------------------------------------- report

def summarize(episodes: list[dict], outcomes_of) -> dict:
    by_action: dict[str, dict[str, int]] = {}
    for ep in episodes:
        for kind, outcome, _ in outcomes_of(ep):
            row = by_action.setdefault(str(kind), {})
            row[outcome] = row.get(outcome, 0) + 1
    attempts = sum(sum(r.values()) for k, r in by_action.items() if k not in ("None",))
    breaches = sum(len(e["breaches"]) for e in episodes)
    resets = [e["reset_ms"] for e in episodes]
    tampered = [e for e in episodes if e["tampered"]]
    return {
        "episodes": len(episodes), "attempts": attempts, "by_action": by_action,
        "episodes_breached": sum(1 for e in episodes if e["breaches"]), "breaches": breaches,
        "breach_rate_upper95_pct": upper95(sum(1 for e in episodes if e["breaches"]), len(episodes)),
        "episodes_with_db_tampering": len(tampered),
        "tampering_flagged_by_hub": sum(e["hub_flagged"] for e in tampered),
        "tampering_flagged_by_verify": sum(e["verify_flagged"] for e in tampered),
        "tampering_unseen_by_hub_alone": sum(e["blind_alone"] for e in tampered),
        "unseen_and_repaired_by_sync": sum(e["blind_alone"] and e["repaired_by_sync"] for e in tampered),
        "genuine_alerts_delivered": sum(e["genuine_delivered"] for e in episodes),
        "hub_errors": sum(r.get("hub error", 0) for r in by_action.values()),
        "reset_ms_median": round(statistics.median(resets), 2) if resets else None,
        "reset_ms_p95": round(sorted(resets)[int(0.95 * (len(resets) - 1))], 2) if resets else None,
        "resets_identical_to_golden": sum(e["reset_identical"] for e in episodes),
        "breach_examples": [b for e in episodes for b in e["breaches"]][:10],
    }


def no_model():
    """Episodes score priority with plain rules: no model call per attempt."""
    os.environ["TRIAGE_ON_INGEST"] = "0"


def main(argv=None) -> int:
    no_model()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--llm-episodes", type=int, default=20)
    ap.add_argument("--steps", type=int, default=8, help="attempts per LLM episode")
    ap.add_argument("--model", default=os.getenv("GYM_MODEL", "llama3.2:3b"))
    ap.add_argument("--fuzz-episodes", type=int, default=2000)
    ap.add_argument("--fuzz-steps", type=int, default=20)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--replays", type=int, default=50, help="fuzz episodes re-run from their seed to check resets")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)

    folder = Path(tempfile.mkdtemp(prefix="gym-"))
    golden = build_golden(folder)
    golden_sha = sha256_file(golden["path"])
    out: dict = {"date": date.today().isoformat(), "seed": args.seed, "golden": {
        "events": len(golden["golden_ids"]), "roster": len(golden["roster"]), "intercepted": len(golden["intercepted"])}}

    # Fuzzer: many isolated episodes in parallel processes, each on its own database copy.
    t = time.perf_counter()
    seeds = [args.seed * 1_000_000 + i for i in range(args.fuzz_episodes)]
    with ProcessPoolExecutor(args.workers, initializer=no_model) as pool:
        fuzz = list(pool.map(fuzz_episode, [(golden, str(folder), s, args.fuzz_steps) for s in seeds], chunksize=16))
    wall = time.perf_counter() - t
    out["fuzzer"] = summarize(fuzz, lambda e: e["outcomes"]) | {
        "steps_per_episode": args.fuzz_steps, "workers": args.workers, "wall_s": round(wall, 1),
        "attempts_per_s": round(args.fuzz_episodes * args.fuzz_steps / wall)}
    # Reset correctness: the same seed from a fresh reset must end in the same state.
    again = [fuzz_episode((golden, str(folder), s, args.fuzz_steps)) for s in seeds[:args.replays]]
    out["fuzzer"]["replays_identical"] = sum(a["fingerprint"] == b["fingerprint"] and a["outcomes"] == b["outcomes"]
                                             for a, b in zip(fuzz, again))
    out["fuzzer"]["replays"] = len(again)
    print(f"fuzzer: {out['fuzzer']['episodes']} episodes, {out['fuzzer']['attempts']} attempts, "
          f"{out['fuzzer']['breaches']} breaches, reset {out['fuzzer']['reset_ms_median']} ms", flush=True)

    # LLM attacker: adaptive, sees each refusal reason.
    if args.llm_episodes:
        client = httpx.Client()
        llm = []
        for i in range(args.llm_episodes):
            llm.append(llm_episode(golden, folder, args.seed * 1000 + i, args.steps, args.model, client))
            last = llm[-1]
            print(f"llm episode {i + 1}/{args.llm_episodes}: "
                  f"{sum(s['outcome'] == 'accepted' for s in last['transcript'])} accepted, {len(last['breaches'])} breaches", flush=True)
        out["llm"] = summarize(llm, lambda e: [((s["action"] or {}).get("action") if isinstance(s["action"], dict) else None,
                                                s["outcome"], s["detail"]) for s in e["transcript"]])
        out["llm"] |= {"model": args.model, "steps_per_episode": args.steps,
                       "invalid_moves": sum(s["outcome"] in ("invalid", "malformed") for e in llm for s in e["transcript"]),
                       "transcripts": [e["transcript"] for e in llm]}

    out["isolation"] = {"golden_unchanged": sha256_file(golden["path"]) == golden_sha}
    shutil.rmtree(folder, ignore_errors=True)

    RESULTS.mkdir(exist_ok=True)
    stem = RESULTS / f"directorate_gym_{out['date']}"
    stem.with_suffix(".json").write_text(json.dumps(out, indent=1))
    stem.with_suffix(".md").write_text(report_md(out))
    print(report_md(out))
    breached = (out["fuzzer"]["breaches"] + out.get("llm", {}).get("breaches", 0)
                + out["fuzzer"]["hub_errors"] + out.get("llm", {}).get("hub_errors", 0))
    return 1 if breached or not out["isolation"]["golden_unchanged"] else 0


def report_md(o: dict) -> str:
    f, l = o["fuzzer"], o.get("llm")
    rows = [("Episodes", "episodes"), ("Attempts", "attempts"), ("Episodes with a breach", "episodes_breached"),
            ("95% upper bound on episodes breached (%)", "breach_rate_upper95_pct"),
            ("Episodes that edited or deleted rows", "episodes_with_db_tampering"),
            ("…flagged by the hub's chain check", "tampering_flagged_by_hub"),
            ("…flagged by verify.py", "tampering_flagged_by_verify"),
            ("…unseen by the hub alone (known limit)", "tampering_unseen_by_hub_alone"),
            ("…of those, put back by one sync round", "unseen_and_repaired_by_sync"),
            ("Real intercepted alerts delivered (not a breach)", "genuine_alerts_delivered"),
            ("Attacks that made the hub raise an error", "hub_errors"),
            ("Reset, median ms", "reset_ms_median"), ("Reset, 95th percentile ms", "reset_ms_p95"),
            ("Resets identical to the golden hub", "resets_identical_to_golden")]
    head = "| Metric | Fuzzer | " + (f"LLM attacker ({l['model']}) |" if l else "") + "\n|---|---|" + ("---|" if l else "")
    body = "\n".join(f"| {label} | {f.get(k)} | " + (f"{l.get(k)} |" if l else "") for label, k in rows)
    lines = [
        f"## Directorate gym ({o['date']}): adaptive attackers, one isolated episode each", "",
        f"Golden hub: {o['golden']['events']} signed events, a roster of {o['golden']['roster']}, "
        f"{o['golden']['intercepted']} intercepted alerts. Every episode runs on its own copy and is thrown away.", "",
        head, body, "",
        f"Fuzzer: {f['steps_per_episode']} attempts per episode on {f['workers']} processes, {f['attempts_per_s']} attempts/s; "
        f"{f['replays_identical']} of {f['replays']} episodes replayed from their seed ended in the identical state. "
        f"Golden database unchanged after every episode: {o['isolation']['golden_unchanged']}.",
    ]
    if l:
        lines.append(f"LLM attacker: {l['steps_per_episode']} moves per episode, seeing each refusal reason; "
                     f"{l['invalid_moves']} moves were malformed or invalid.")
    lines += ["", "Refusals by action (fuzzer):", ""]
    for kind, r in sorted(f["by_action"].items()):
        lines.append(f"- `{kind}`: " + ", ".join(f"{n} {k}" for k, n in sorted(r.items(), key=lambda kv: -kv[1])))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    sys.exit(main())
