"""Headline numbers 1 and 2: what the Directorate's attacks get past the hub.

Part 1, forged and replayed messages (number 1). Starts a real hub with signing
required and a roster of one operator and three members, sends real alerts from
members (they must all be accepted), then runs each attack N times against
POST /events, POST /roster and POST /sync/events:

  forged         an outsider's own key signs an "all clear"            → unknown key
  impersonated   a member's public key, but signed by the outsider     → bad signature
  tampered       a member's real alert with one field changed          → bad signature
  replayed       a member's alert that was already accepted, resent    → duplicate id
  re-id replay   that alert with a new id so it looks new              → bad signature
  wrong hub      a member's alert meant for another hub, sent here     → addressed elsewhere
  stale          a member's alert created 2 hours ago, never delivered → outside the time window
  unsigned       no signature at all                                   → unsigned
  roster grab    a member (not an operator) signs "add the outsider"   → not an operator
  sync forged    the forged alert pushed through POST /sync/events     → not stored
  sync tampered  the tampered alert pushed through POST /sync/events   → bad signature
  sync own-hub   a pushed event claiming to come from THIS hub        → only this hub writes its chain

Part 2, edited records (number 2). Takes the hub's database after part 1 and, on a
fresh copy per trial, edits it directly the way someone with the laptop could, then
runs the same chain check as GET /events/verify. Caught = the check names the exact
row: the edited row, or for a deleted row the one right after it.

  payload / level / author / created_at   one field changed in place
  rehash          a field changed and that row's hash recomputed
  rehash chain    a field changed and every hash from there on recomputed
  delete          a row in the middle of the chain deleted
  delete newest   the newest row deleted: caught because the hub keeps the hash of
                  every event it wrote (own_hashes), so the row it wrote is missing

Known limits, measured and reported but not counted in N: changing `priority`
(the hub's own score, outside the hash on purpose), and deleting the newest row
together with the hub's own record of writing it (one hub alone can't tell).

Part 3, deleted rows put back (two hubs). Starts hub-L34 and hub-L12 synced, then
deletes rows of L34's own chain straight from its database while both run. Counted:
the row is back within the timeout, the chain check passes, and L34's "forgeries
blocked" counter didn't move (a row coming home isn't a forgery).

    hub/.venv/bin/python eval/run_attacks.py              # 25 of each attack, 20 of each edit
    hub/.venv/bin/python eval/run_attacks.py --n 50 --trials 40 --restores 40
"""

import argparse
import json
import random
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hub_procs import ROOT, alert_fields, crypto, iso, signed_alert, start_hub, stop, wait_up  # noqa: E402

from app.log import EventLog, compute_hash  # noqa: E402

HUB, LEVEL = "hub-L34", 34
PEER, PEER_LEVEL = "hub-L12", 12  # sync attacks pretend to come from the other hub


def upper95(accepted: int, n: int) -> float:
    """95% upper bound on the true rate. 0 of n: the rule of three, 3/n."""
    if accepted == 0:
        return 3 / n
    p = accepted / n
    return min(1.0, p + 1.96 * (p * (1 - p) / n) ** 0.5)


# ---------------------------------------------------------------- part 1: messages

def run_messages(url, client, keys, rng, n, n_real):
    op, members, outsider = keys["op"], keys["members"], keys["outsider"]

    def real():
        return signed_alert(HUB, LEVEL, rng.choice(members), rng)

    accepted_real = []
    for _ in range(n_real):
        r = client.post(f"{url}/events", json=real())
        if r.status_code == 201:
            accepted_real.append(r.json())

    def tamper(e):
        e = dict(e)
        field = rng.choice(["level", "payload", "created_at", "author"])
        if field == "level":
            e["level"] = rng.choice([l for l in range(1, 41) if l != e["level"]])
        elif field == "payload":
            e["payload"] = {**e["payload"], "severity": "low", "note": "all clear"}
        elif field == "created_at":  # one minute earlier: still inside the time window
            t = datetime.fromisoformat(e["created_at"].replace("Z", "+00:00")) - timedelta(minutes=1)
            e["created_at"] = iso(t)
        else:
            e["author"] = "directorate"
        return e

    def forged(hub=HUB, level=LEVEL):
        f = alert_fields(hub, level, rng)
        f["payload"] = {"kind": "flooding", "severity": "low", "note": f"all clear, level {level}"}
        return crypto.sign(f, outsider)

    def impersonated():
        e = crypto.sign(alert_fields(HUB, LEVEL, rng), outsider)
        e["author_pub"] = crypto.public_key(rng.choice(members))
        return e

    def without(e, *drop):
        return {k: v for k, v in e.items() if k not in drop}

    def as_synced(e):
        """What a pushed event looks like: with prev_hash/hash, so it passes the hash check."""
        e = {**e, "prev_hash": "0" * 64, "priority": e.get("priority")}
        e["hash"] = compute_hash(e, e["prev_hash"])
        return e

    attacks = {
        "forged": ("events", forged),
        "impersonated": ("events", impersonated),
        "tampered": ("events", lambda: tamper(signed_alert(HUB, LEVEL, rng.choice(members), rng))),
        "replayed": ("events", lambda: without(rng.choice(accepted_real), "prev_hash", "hash")),
        "re-id replay": ("events", lambda: {**without(rng.choice(accepted_real), "prev_hash", "hash"), "id": str(uuid.uuid4())}),
        "wrong hub": ("events", lambda: signed_alert("hub-L12", 12, rng.choice(members), rng)),
        "stale": ("events", lambda: signed_alert(HUB, LEVEL, rng.choice(members), rng, age=timedelta(hours=2))),
        "unsigned": ("events", lambda: without(alert_fields(HUB, LEVEL, rng), "id", "created_at", "hub_id")),
        "roster grab": ("roster", lambda: crypto.sign({
            **alert_fields(HUB, LEVEL, rng), "type": "roster", "author": "member", "source": None, "device_id": None,
            "payload": {"action": "add", "pub": crypto.public_key(outsider), "role": "operator"},
        }, rng.choice(members))),
        "sync forged": ("sync", lambda: as_synced(forged(PEER, PEER_LEVEL))),
        "sync tampered": ("sync", lambda: as_synced(tamper(signed_alert(PEER, PEER_LEVEL, rng.choice(members), rng)))),
        "sync own-hub": ("sync", lambda: as_synced(signed_alert(HUB, LEVEL, rng.choice(members), rng))),
    }
    rows = {}
    for name, (route, make) in attacks.items():
        accepted, reasons = 0, {}
        for _ in range(n):
            body = make()
            if route == "sync":
                r = client.post(f"{url}/sync/events", json=[body])
                stored = r.json()["stored"] if r.status_code == 200 else 0
                accepted += stored
                outcome = "stored" if stored else ("deferred" if r.json().get("deferred") else "rejected")
            else:
                r = client.post(f"{url}/{route}", json=body)
                accepted += r.status_code == 201
                outcome = "stored" if r.status_code == 201 else r.json().get("detail", str(r.status_code))
            reasons[outcome] = reasons.get(outcome, 0) + 1
        rows[name] = {"n": n, "accepted": accepted, "outcomes": reasons}
        print(f"  {name:14} {accepted}/{n} accepted   {reasons}")

    held = set(client.get(f"{url}/sync/ids").json()["ids"])
    return {
        "real_sent": n_real, "real_accepted": len(accepted_real),
        "attacks": rows,
        "attack_n": sum(r["n"] for r in rows.values()),
        "attack_accepted": sum(r["accepted"] for r in rows.values()),
        "stored_events": len(held),
        "only_real_stored": held == {e["id"] for e in accepted_real},
        "rejected_counter": client.get(f"{url}/rejected").json()["total"],
        "verify": client.get(f"{url}/events/verify").json(),
    }


# ---------------------------------------------------------------- part 2: edited records

def run_edits(db: Path, tmp: Path, rng, trials):
    with sqlite3.connect(db) as con:
        order = [r[0] for r in con.execute("SELECT id FROM events WHERE hub_id = ? ORDER BY seq", (HUB,))]

    def edit(kind):
        path = tmp / f"edit-{uuid.uuid4().hex}.db"
        shutil.copy(db, path)
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        if kind in ("delete", "rehash chain", "rehash", "payload", "level", "author", "created_at", "priority"):
            target = rng.choice(order[1:-1] if kind == "delete" else order)
        else:  # delete newest (with or without the hub's own record of it)
            target = order[-1]
        expect = target
        if kind in ("delete", "delete newest", "delete newest and record"):
            con.execute("DELETE FROM events WHERE id = ?", (target,))
            if kind == "delete":
                expect = order[order.index(target) + 1]  # the next row points at the missing one
            if kind == "delete newest and record":
                con.execute("DELETE FROM own_hashes WHERE event_id = ?", (target,))
        elif kind == "priority":
            con.execute("UPDATE events SET priority = 0.01 WHERE id = ?", (target,))
        else:
            col, val = {
                "payload": ("payload", json.dumps({"kind": "flooding", "severity": "low", "note": "all clear"})),
                "level": ("level", 12),
                "author": ("author", "directorate"),
                "created_at": ("created_at", "2087-01-01T00:00:00Z"),
            }.get(kind, ("payload", json.dumps({"kind": "flooding", "severity": "low", "note": "all clear"})))
            con.execute(f"UPDATE events SET {col} = ? WHERE id = ?", (val, target))
            if kind.startswith("rehash"):
                rows = con.execute("SELECT * FROM events WHERE hub_id = ? ORDER BY seq", (HUB,)).fetchall()
                start = next(i for i, r in enumerate(rows) if r["id"] == target)
                prev = rows[start]["prev_hash"]
                for r in rows[start:(start + 1 if kind == "rehash" else len(rows))]:
                    fields = {**dict(r), "payload": json.loads(r["payload"]), "prev_hash": prev}
                    h = compute_hash(fields, prev)
                    con.execute("UPDATE events SET prev_hash = ?, hash = ? WHERE id = ?", (prev, h, r["id"]))
                    prev = h
        con.commit()
        con.close()
        report = EventLog(str(path), HUB).verify_report()  # the same check as GET /events/verify
        path.unlink()
        return report["first_bad_event"] == expect and expect is not None, report["first_bad_event"] is not None

    counted = ["payload", "level", "author", "created_at", "rehash", "rehash chain", "delete", "delete newest"]
    limits = ["priority", "delete newest and record"]
    rows = {}
    for kind in counted + limits:
        caught = flagged = 0
        for _ in range(trials):
            exact, any_flag = edit(kind)
            caught += exact
            flagged += any_flag
        rows[kind] = {"n": trials, "caught_exact_row": caught, "flagged": flagged, "counted": kind in counted}
        print(f"  {kind:14} {caught}/{trials} caught at the exact row" + ("" if kind in counted else "   (known limit)"))
    return {
        "edits": rows,
        "edit_n": sum(r["n"] for r in rows.values() if r["counted"]),
        "edit_caught": sum(r["caught_exact_row"] for r in rows.values() if r["counted"]),
    }


# ---------------------------------------------------------------- part 3: deleted rows put back

def run_restores(tmp: Path, keys, rng, trials: int, port: int, timeout_s: float = 15):
    """Two synced hubs; delete rows of L34's own chain from its database while both run."""
    a_url, b_url = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{port + 1}"
    run = tmp / "restores"
    run.mkdir()
    shutil.copy(tmp / "roster.json", run / "roster.json")
    procs = [start_hub(HUB, port, str(run), peers=[port + 1]), start_hub(PEER, port + 1, str(run), peers=[port])]
    client = httpx.Client(timeout=10)
    try:
        for url in (a_url, b_url):
            wait_up(client, url)
        sent = []
        for _ in range(trials + 2):
            e = signed_alert(HUB, LEVEL, rng.choice(keys["members"]), rng)
            assert client.post(f"{a_url}/events", json=e).status_code == 201
            sent.append(e["id"])
        end = time.time() + 60
        while not set(sent) <= set(client.get(f"{b_url}/sync/ids").json()["ids"]):
            if time.time() > end:
                raise SystemExit("the peer never received the alerts")
            time.sleep(0.2)
        counter_before = client.get(f"{a_url}/rejected").json()["total"]
        restored = intact = 0
        seconds = []
        for i in range(trials):
            target = sent[-1] if i % 2 == 0 else rng.choice(sent[1:-1])  # newest, or one in the middle
            db = sqlite3.connect(run / f"{HUB}.db")
            db.execute("DELETE FROM events WHERE id = ?", (target,))
            db.commit()
            db.close()
            t0, back = time.time(), False
            while time.time() - t0 < timeout_s:
                if target in client.get(f"{a_url}/sync/ids").json()["ids"]:
                    back = True
                    break
                time.sleep(0.1)
            seconds.append(time.time() - t0)
            restored += back
            intact += back and client.get(f"{a_url}/events/verify").json()["chain_intact"]
        time.sleep(3)  # more sync ticks: the counter must still not move
        counter_moved = client.get(f"{a_url}/rejected").json()["total"] - counter_before
        status = client.get(f"{a_url}/sync/status").json()
    finally:
        client.close()
        stop(procs)
    seconds.sort()
    print(f"  {restored}/{trials} deleted rows put back by the other hub, chain intact after {intact}, "
          f"counter moved by {counter_moved}, median {seconds[len(seconds) // 2]:.1f} s")
    return {"restore_n": trials, "restored": restored, "restored_intact": intact,
            "restore_counter_moved": counter_moved, "restore_median_s": round(seconds[len(seconds) // 2], 2),
            "restore_hub_count": status["restored"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=25, help="tries of each message attack")
    ap.add_argument("--real", type=int, default=40, help="real member alerts sent first")
    ap.add_argument("--trials", type=int, default=20, help="trials of each database edit")
    ap.add_argument("--restores", type=int, default=20, help="rows deleted for part 3 (two hubs)")
    ap.add_argument("--port", type=int, default=8111, help="part 1 uses it; part 3 the next two")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    keys = {"op": crypto.new_key(), "members": [crypto.new_key() for _ in range(3)], "outsider": crypto.new_key()}
    tmp = Path(tempfile.mkdtemp(prefix="attacks-"))
    (tmp / "roster.json").write_text(json.dumps(
        [{"pub": crypto.public_key(keys["op"]), "role": "operator"}]
        + [{"pub": crypto.public_key(k), "role": "member"} for k in keys["members"]]
    ))
    url = f"http://127.0.0.1:{args.port}"
    client = httpx.Client(timeout=10)
    proc = start_hub(HUB, args.port, str(tmp))
    try:
        wait_up(client, url)
        print("Part 1: forged and replayed messages")
        messages = run_messages(url, client, keys, rng, args.n, args.real)
    finally:
        stop([proc])
    print("Part 2: edited records")
    edits = run_edits(tmp / f"{HUB}.db", tmp, rng, args.trials)
    print("Part 3: deleted rows put back by the other hub")
    restores = run_restores(tmp, keys, rng, args.restores, args.port + 1)
    shutil.rmtree(tmp)

    m, e, r = messages, edits, restores
    results = {
        "split": "attacks", "backend": "hub-checks", "date": date.today().isoformat(), "seed": args.seed,
        **m, **e, **r,
        "attack_accept_upper95": upper95(m["attack_accepted"], m["attack_n"]),
        "edit_miss_upper95": upper95(e["edit_n"] - e["edit_caught"], e["edit_n"]),
    }
    results["passed"] = (
        m["attack_accepted"] == 0 and m["real_accepted"] == m["real_sent"] and m["only_real_stored"]
        and m["verify"]["chain_intact"] and e["edit_caught"] == e["edit_n"]
        and r["restored_intact"] == r["restore_n"] and r["restore_counter_moved"] == 0
    )
    lim = e["edits"]
    lines = [
        f"## Directorate attacks ({date.today().isoformat()}, real hub, generated attacks)",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Forged and replayed messages accepted | {m['attack_accepted']} of {m['attack_n']} "
        f"(95% upper bound {results['attack_accept_upper95'] * 100:.1f}%) |",
        f"| Real member alerts accepted | {m['real_accepted']} of {m['real_sent']} |",
        f"| \"Forgeries blocked\" counter | {m['rejected_counter']} |",
        f"| Edited records caught at the exact row | {e['edit_caught']} of {e['edit_n']} "
        f"(95% upper bound on misses {results['edit_miss_upper95'] * 100:.1f}%) |",
        f"| Deleted rows put back by the other hub (two hubs) | {r['restored_intact']} of {r['restore_n']}, "
        f"chain intact, counter moved by {r['restore_counter_moved']}, median {r['restore_median_s']} s |",
        "",
        "| Attack | Accepted | What the hub said |",
        "|---|---|---|",
        *[f"| {k} | {v['accepted']} of {v['n']} | {', '.join(f'{r} ({c})' for r, c in v['outcomes'].items())} |"
          for k, v in m["attacks"].items()],
        "",
        "| Edit to the database | Caught at the exact row |",
        "|---|---|",
        *[f"| {k}{'' if v['counted'] else ' (known limit, not counted)'} | {v['caught_exact_row']} of {v['n']} |"
          for k, v in lim.items()],
        "",
        "Known limits: `priority` is the hub's own score and sits outside the hash on purpose, so "
        "changing it isn't caught. Deleting the newest row is caught because the hub keeps the hash of "
        "every event it wrote; an attacker who also erases that record hides it from a hub on its own. "
        "With two hubs the other one still holds the row; it can't be put back then, but the hub's refusal "
        "of its own missing event is logged once in GET /rejected.",
    ]
    table = "\n".join(lines)
    stem = f"attacks_generated_{date.today().isoformat()}"
    out = ROOT / "eval" / "results"
    (out / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out / f"{stem}.md").write_text(table + "\n")
    print("\n" + table + f"\n\nwrote eval/results/{stem}.*")
    sys.exit(0 if results["passed"] else 1)


if __name__ == "__main__":
    main()
