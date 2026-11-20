"""Don't trust the hub: check it. An independent audit of a hub's log.

This file imports nothing from the hub (no `app.*`). It re-derives every check from the
published rules, using only the standard library and PyNaCl, so an auditor can read
these ~300 lines instead of the hub's code and still trust the verdict:

  1. Each event's hash matches its content (SHA-256 over the signed fields + sig + prev_hash).
  2. Each signed event's Ed25519 signature is valid for its author_pub.
  3. Each signer was on the roster when it signed: the auditor brings the starting roster
     (a file it got in person, not from the hub), and roster changes count only if an
     operator on the roster at that time signed them.
  4. Each origin hub's chain links up: no two events claim the same predecessor (a fork),
     and on the audited hub's own chain no predecessor is missing (a deleted row).
  5. From a database file: every event the hub recorded writing is still there.
  6. Two hubs (--hub twice): they hold the same events, and no id has two versions.

    .venv/bin/python scripts/verify.py --hub http://127.0.0.1:8001 --roster demo/roster.json
    .venv/bin/python scripts/verify.py --hub http://127.0.0.1:8001 --hub http://127.0.0.1:8002 --roster demo/roster.json
    .venv/bin/python scripts/verify.py --db demo/run/hub-L34.db --roster demo/roster.json
    .venv/bin/python scripts/verify.py --file export.json --own hub-L34 --roster demo/roster.json

Options: --save FILE writes the fetched events (an export to take away and re-check);
--json FILE writes the report; --sign-key KEYFILE signs that report with the auditor's
own Ed25519 key (a roster_tool.py key file); --check-report FILE checks a signed report.
Exit code 0 means every check passed, 1 means something failed (listed in the report).
"""

import argparse
import base64
import hashlib
import json
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

# The published rules, restated (hub/app/models.py SIGNED_FIELDS, hub/app/log.py GENESIS).
SIGNED_FIELDS = ("id", "type", "hub_id", "level", "created_at", "author", "payload",
                 "author_pub", "source", "device_id")
GENESIS = "0" * 64


# --------------------------------------------------------------------------- the rules

def signed_bytes(e: dict) -> bytes:
    """What the signer signed: SIGNED_FIELDS minus nulls, sorted compact JSON, UTF-8 as is."""
    content = {k: e[k] for k in SIGNED_FIELDS if e.get(k) is not None}
    return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def event_hash(e: dict) -> str:
    """The chain hash: SIGNED_FIELDS + sig minus nulls, sorted compact JSON (ASCII), + prev_hash."""
    content = {k: e[k] for k in (*SIGNED_FIELDS, "sig") if e.get(k) is not None}
    blob = json.dumps(content, sort_keys=True, separators=(",", ":")) + e["prev_hash"]
    return hashlib.sha256(blob.encode()).hexdigest()


def sig_ok(pub_b64: str, message: bytes, sig_b64: str) -> bool:
    try:
        VerifyKey(base64.b64decode(pub_b64, validate=True)).verify(message, base64.b64decode(sig_b64, validate=True))
        return True
    except (BadSignatureError, ValueError, TypeError):
        return False


def fingerprint(events: list[dict]) -> str:
    """Same formula as a hub's /health fingerprint, so the two can be compared."""
    hashes = sorted(e["hash"] for e in events)
    return hashlib.sha256((f"{len(hashes)}:" + ",".join(hashes)).encode()).hexdigest()[:12]


def when(e: dict) -> datetime:
    try:
        t = datetime.fromisoformat(e["created_at"].replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError, KeyError):
        return datetime.min.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- sources

def from_hub(url: str) -> dict:
    def get(path):
        with urllib.request.urlopen(url.rstrip("/") + path, timeout=10) as r:
            return json.load(r)
    health = get("/health")
    return {"name": url, "events": get("/events"), "own": health.get("hub_id"),
            "claimed": {"events": health.get("events"), "fingerprint": health.get("fingerprint"),
                        "chain_intact": health.get("chain_intact")}}


def from_db(path: str) -> dict:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)  # read only: an audit never writes
    db.row_factory = sqlite3.Row
    events = []
    for row in db.execute("SELECT * FROM events ORDER BY seq"):
        e = dict(row)
        e.pop("seq", None)
        e["payload"] = json.loads(e["payload"])
        events.append(e)
    written = [dict(r) for r in db.execute("SELECT hash, event_id FROM own_hashes ORDER BY n")]
    by_hash = {e["hash"]: e for e in events}
    own = next((by_hash[w["hash"]]["hub_id"] for w in written if w["hash"] in by_hash), None)
    return {"name": path, "events": events, "own": own, "written": written}


def from_file(path: str, own: str | None) -> dict:
    data = json.loads(Path(path).read_text())
    events = data["events"] if isinstance(data, dict) else data
    return {"name": path, "events": events, "own": own or (data.get("own") if isinstance(data, dict) else None)}


# --------------------------------------------------------------------------- the audit

def audit(src: dict, roster: list[dict] | None) -> dict:
    events, own = src["events"], src.get("own")
    problems: list[dict] = []

    def bad(kind, e, detail=""):
        problems.append({"check": kind, "event": e.get("id") if isinstance(e, dict) else e, "detail": detail})

    # 1-2. Each event on its own.
    signed = unsigned = simulated = 0
    for e in events:
        if event_hash(e) != e.get("hash"):
            bad("hash", e, "content doesn't match its hash: edited after it was stored")
        if e.get("sig"):
            signed += 1
            if not e.get("author_pub") or not sig_ok(e["author_pub"], signed_bytes(e), e["sig"]):
                bad("signature", e, "signature doesn't verify for its author_pub")
        else:
            unsigned += 1
        if isinstance(e.get("payload"), dict) and e["payload"].get("simulated") is True:
            simulated += 1

    # 3. Who signed, replaying the roster in signing order.
    if roster is not None:
        roles = {m["pub"]: m.get("role", "member") for m in roster}
        for e in sorted((e for e in events if e.get("sig")), key=when):
            pub = e.get("author_pub")
            if e.get("type") == "roster":
                p = e.get("payload") or {}
                if roles.get(pub) != "operator":
                    bad("roster", e, "roster change not signed by an operator at the time: ignored")
                    continue
                if p.get("action") == "add" and isinstance(p.get("pub"), str):
                    roles[p["pub"]] = p.get("role", "member")
                elif p.get("action") == "remove":
                    roles.pop(p.get("pub"), None)
            elif pub not in roles:
                bad("signer", e, f"signed by a key not on the roster at {e.get('created_at')}")

    # 4. Each origin hub's chain.
    chains: dict[str, dict] = {}
    by_origin: dict[str, list[dict]] = {}
    for e in events:
        by_origin.setdefault(e.get("hub_id"), []).append(e)
    for origin, evs in sorted(by_origin.items(), key=lambda kv: str(kv[0])):
        hashes = {e["hash"] for e in evs}
        seen_prev: dict[str, str] = {}
        gaps = 0
        for e in evs:
            prev = e.get("prev_hash")
            if prev in seen_prev:
                bad("fork", e, f"claims the same predecessor as {seen_prev[prev]}")
            seen_prev.setdefault(prev, e.get("id"))
            if prev != GENESIS and prev not in hashes:
                if origin == own:
                    bad("missing row", e, "its predecessor on this hub's own chain is gone: a deleted row")
                else:
                    gaps += 1
        chains[origin] = {"events": len(evs), "waiting_for_predecessor": gaps}

    # 5. Rows the hub recorded writing (database files only).
    if "written" in src:
        stored = {e["hash"] for e in events}
        for w in src["written"]:
            if w["hash"] not in stored:
                bad("missing row", w["event_id"], "this hub wrote it and it is no longer stored")

    report = {
        "source": src["name"], "own_hub": own,
        "events": len(events), "signed": signed, "unsigned": unsigned, "simulated": simulated,
        "fingerprint": fingerprint(events), "chains": chains,
        "roster_checked": roster is not None, "problems": problems,
    }
    if "claimed" in src:  # what the hub says about itself, against what we computed
        c = src["claimed"]
        report["hub_claims"] = c
        if c.get("fingerprint") not in (None, report["fingerprint"]):
            # The hub may have taken an event between the two requests; say so rather than fail.
            report["note"] = "the hub's own fingerprint differs from ours: it changed between requests, or it misreports"
    report["passed"] = not problems
    return report


def cross_check(a: dict, b: dict) -> dict:
    ea = {e["id"]: e["hash"] for e in a["events"]}
    eb = {e["id"]: e["hash"] for e in b["events"]}
    conflicts = sorted(i for i in ea.keys() & eb.keys() if ea[i] != eb[i])
    return {
        "a": a["name"], "b": b["name"],
        "only_in_a": sorted(ea.keys() - eb.keys()), "only_in_b": sorted(eb.keys() - ea.keys()),
        "conflicts": conflicts,  # same id, different content: one of them was altered
        "same_events": ea == eb,
        "passed": not conflicts,  # missing events are normal mid-sync; two versions never are
    }


# --------------------------------------------------------------------------- signed reports

def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sign_report(report: dict, key_file: str) -> dict:
    data = json.loads(Path(key_file).read_text())
    key = SigningKey(base64.b64decode(data["seed"], validate=True))
    sig = key.sign(canonical(report)).signature
    return {**report, "auditor": {"pub": base64.b64encode(bytes(key.verify_key)).decode(),
                                  "sig": base64.b64encode(sig).decode()}}


def check_report(path: str) -> bool:
    report = json.loads(Path(path).read_text())
    auditor = report.pop("auditor", None)
    if not auditor:
        print("not signed: no auditor field")
        return False
    ok = sig_ok(auditor["pub"], canonical(report), auditor["sig"])
    print(f"{'valid' if ok else 'INVALID'} signature by auditor {auditor['pub']}"
          f"{'' if ok else ': the report was changed after signing'}")
    return ok


# --------------------------------------------------------------------------- output

def print_report(r: dict) -> None:
    mark = "PASS" if r["passed"] else "FAIL"
    print(f"\n{mark}  {r['source']}  (own hub: {r['own_hub'] or 'unknown'})")
    print(f"  {r['events']} events: {r['signed']} signed, {r['unsigned']} unsigned "
          f"(can't be checked), {r['simulated']} labelled simulated")
    print(f"  fingerprint {r['fingerprint']}"
          + (f"  (hub says {r['hub_claims']['fingerprint']}, chain_intact={r['hub_claims']['chain_intact']})"
             if "hub_claims" in r else ""))
    for origin, c in r["chains"].items():
        wait = f", {c['waiting_for_predecessor']} waiting for a predecessor (normal mid-sync)" \
            if c["waiting_for_predecessor"] else ""
        print(f"  chain {origin}: {c['events']} events{wait}")
    print(f"  roster: {'every signer checked' if r['roster_checked'] else 'NOT checked (pass --roster)'}")
    if r.get("note"):
        print(f"  note: {r['note']}")
    for p in r["problems"][:20]:
        print(f"  ✗ {p['check']}: {p['event']}  {p['detail']}")
    if len(r["problems"]) > 20:
        print(f"  … and {len(r['problems']) - 20} more (see --json)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--hub", action="append", default=[], help="a hub's URL (twice to cross-check two hubs)")
    ap.add_argument("--db", action="append", default=[], help="a hub's SQLite file (opened read-only)")
    ap.add_argument("--file", action="append", default=[], help="an export from --save, or a JSON list of events")
    ap.add_argument("--own", help="for --file: which hub the export came from")
    ap.add_argument("--roster", help="the starting roster you trust (JSON list of {pub, role})")
    ap.add_argument("--save", help="write the fetched events of the first source here")
    ap.add_argument("--json", help="write the full report here")
    ap.add_argument("--sign-key", help="sign the report with this key file (roster_tool.py new-key)")
    ap.add_argument("--check-report", help="check a signed report's signature and exit")
    args = ap.parse_args(argv)

    if args.check_report:
        return 0 if check_report(args.check_report) else 1
    sources = ([from_hub(u) for u in args.hub] + [from_db(p) for p in args.db]
               + [from_file(p, args.own) for p in args.file])
    if not sources:
        ap.error("give at least one --hub, --db or --file")
    roster = json.loads(Path(args.roster).read_text()) if args.roster else None

    if args.save:
        Path(args.save).write_text(json.dumps({"own": sources[0]["own"], "events": sources[0]["events"]}, indent=1))
    reports = [audit(s, roster) for s in sources]
    for r in reports:
        print_report(r)
    crosses = [cross_check(sources[i], sources[j]) for i in range(len(sources)) for j in range(i + 1, len(sources))]
    for c in crosses:
        state = "hold the same events" if c["same_events"] else \
            f"differ: {len(c['only_in_a'])} only in the first, {len(c['only_in_b'])} only in the second"
        print(f"\n{'PASS' if c['passed'] else 'FAIL'}  {c['a']} vs {c['b']}: {state}"
              + (f"; {len(c['conflicts'])} ids with two different versions" if c["conflicts"] else ""))

    passed = all(r["passed"] for r in reports) and all(c["passed"] for c in crosses)
    full = {"audited_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "passed": passed, "reports": reports, "cross_checks": crosses}
    if args.sign_key:
        full = sign_report(full, args.sign_key)
    if args.json:
        Path(args.json).write_text(json.dumps(full, indent=1, ensure_ascii=False))
    print(f"\n{'ALL CHECKS PASSED' if passed else 'CHECKS FAILED'}"
          + (f"; report signed by {full['auditor']['pub']}" if args.sign_key else ""))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
