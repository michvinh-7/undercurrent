"""Play the Directorate live: one real attack per command against the running demo hubs.

Each command does one thing to a real hub and prints what the hub said, the
"forgeries blocked" counter and the hub's fingerprint, so the console reacts on
screen while you talk. It targets the hubs started by scripts/demo_hubs.py (their
state file), so nothing needs typing but the command.

    cd hub
    .venv/bin/python scripts/directorate.py forge          # a fake "all clear" from an unknown key
    .venv/bin/python scripts/directorate.py replay         # a real alert sent again
    .venv/bin/python scripts/directorate.py tamper         # a real alert with its words changed
    .venv/bin/python scripts/directorate.py edit           # change a stored record in the database file
    .venv/bin/python scripts/directorate.py delete         # delete the newest record; the other hub puts it back
    .venv/bin/python scripts/directorate.py cut            # cut hub-L34's link (alerts wait)
    .venv/bin/python scripts/directorate.py restore        # restore it (they all arrive)
    .venv/bin/python scripts/directorate.py status         # both hubs: counter, fingerprint, do they agree
    # the operator's answer to a stolen phone: accepted, revoked, refused on both hubs
    .venv/bin/python scripts/directorate.py revoke-demo --member demo/phone.key --operator demo/operator.key

--at L34|L12 picks the hub (default: hub-L12, the console's hub; cut and restore
default to hub-L34, the sender). --hub URL and --db PATH point at hubs not started
by demo_hubs.py. edit and delete open the hub's database file, so they run on the
hub's own machine: that's the attack, someone with the laptop.

Exit code 0 when the hub reacted the way the demo expects, 1 otherwise.
"""

import argparse
import json
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import demo_hubs  # noqa: E402
import roster_tool  # noqa: E402
from app import crypto  # noqa: E402

NAMES = {"L34": "hub-L34", "L12": "hub-L12"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Hubs:
    """The two demo hubs from demo_hubs.py's state, or one hub given by --hub/--db."""

    def __init__(self, args):
        self.client = httpx.Client(timeout=10)
        self.run = Path(args.dir)
        state = demo_hubs.read_state(self.run).get("hubs", [])
        self.urls = {h["hub_id"]: f"http://127.0.0.1:{h['port']}" for h in state}
        self.override = args.hub.rstrip("/") if args.hub else None
        self.db_override = args.db
        if not self.urls and not self.override:
            raise SystemExit("no demo hubs running: start them with scripts/demo_hubs.py up, or pass --hub URL")

    def url(self, hub_id: str) -> str:
        return self.override or self.urls[hub_id]

    def hub_id(self, hub_id: str) -> str:
        return self.client.get(f"{self.override}/health").json()["hub_id"] if self.override else hub_id

    def db(self, hub_id: str) -> Path:
        path = Path(self.db_override) if self.db_override else self.run / f"{hub_id}.db"
        if not path.exists():
            raise SystemExit(f"no database at {path}: edit and delete run on the hub's own machine (--db PATH)")
        return path

    def others(self, hub_id: str) -> list[str]:
        return [h for h in self.urls if h != hub_id] if not self.override else []

    def counter(self, hub_id: str) -> int:
        return self.client.get(f"{self.url(hub_id)}/rejected?limit=1").json()["total"]

    def summary(self, hub_id: str) -> str:
        h = self.client.get(f"{self.url(hub_id)}/health").json()
        return (f"[{h['hub_id']}: forgeries blocked {self.counter(hub_id)}, chain intact {h['chain_intact']}, "
                f"fingerprint {h.get('fingerprint', '?')}]")

    def signed_events(self, hub_id: str) -> list[dict]:
        return [e for e in self.client.get(f"{self.url(hub_id)}/events").json() if e.get("sig") and e["type"] != "roster"]


def resend_body(e: dict) -> dict:
    """An event as a sender would post it: without the hub's chain fields and score."""
    return {k: v for k, v in e.items() if k not in ("prev_hash", "hash", "priority")}


def post(hubs: Hubs, hub_id: str, body: dict) -> tuple[int, str]:
    r = hubs.client.post(f"{hubs.url(hub_id)}/events", json=body)
    return r.status_code, (r.json().get("detail", "") if r.status_code != 201 else "stored")


def expect_refused(hubs, hub_id, what, body) -> int:
    code, said = post(hubs, hub_id, body)
    if code == 403:
        print(f"DIRECTORATE: {what} → {hub_id} refused it: {said}. {hubs.summary(hub_id)}")
        return 0
    print(f"DIRECTORATE: {what} → {hub_id} answered {code} ({said}): NOT refused. {hubs.summary(hub_id)}")
    return 1


def forge(hubs, hub_id, args) -> int:
    level = int(hub_id.split("L")[-1]) if "L" in hub_id else 1
    fake = crypto.sign({
        "id": str(uuid.uuid4()), "type": "hazard", "hub_id": hub_id, "level": level, "created_at": now_iso(),
        "author": f"canary-{level}", "source": "sensor",
        "payload": {"kind": "flooding", "severity": "low", "note": args.note},
    }, crypto.new_key())
    return expect_refused(hubs, hub_id, f'forged "{args.note}"', fake)


def pick_real(hubs, hub_id) -> dict:
    events = hubs.signed_events(hub_id)
    if not events:
        raise SystemExit(f"{hub_id} holds no signed alert yet: send a real one first (the box, a phone or the sim)")
    return events[-1]


def replay(hubs, hub_id, args) -> int:
    e = pick_real(hubs, hub_id)
    return expect_refused(hubs, hub_id, f"replayed a real alert ({e['author']}, level {e['level']})", resend_body(e))


def tamper(hubs, hub_id, args) -> int:
    e = resend_body(pick_real(hubs, hub_id))
    e["id"] = str(uuid.uuid4())  # so it isn't caught as a plain replay: the signature has to catch it
    e["payload"] = {**e["payload"], "severity": "low", "note": "all clear"}
    return expect_refused(hubs, hub_id, "changed a real alert to \"all clear\"", e)


def newest_own(db: Path, hub_id: str) -> str:
    with sqlite3.connect(db) as con:
        row = con.execute("SELECT id FROM events WHERE hub_id = ? ORDER BY seq DESC LIMIT 1", (hub_id,)).fetchone()
    if not row:
        raise SystemExit(f"{hub_id} has no records of its own yet")
    return row[0]


def verify(hubs, hub_id) -> dict:
    return hubs.client.get(f"{hubs.url(hub_id)}/events/verify").json()


def edit(hubs, hub_id, args) -> int:
    db = hubs.db(hub_id)
    target = args.id or newest_own(db, hub_id)
    con = sqlite3.connect(db)
    row = con.execute("SELECT payload FROM events WHERE id = ?", (target,)).fetchone()
    if not row:
        raise SystemExit(f"no record {target} in {db}")
    payload = {**json.loads(row[0]), "severity": "low", "note": "edited by the Directorate"}
    con.execute("UPDATE events SET payload = ? WHERE id = ?", (json.dumps(payload), target))
    con.commit()
    con.close()
    report = verify(hubs, hub_id)
    if report["first_bad_event"] == target:
        print(f"DIRECTORATE: edited record {target[:8]} in {hub_id}'s database → the chain check names "
              f"exactly that record. {hubs.summary(hub_id)}")
        return 0
    print(f"DIRECTORATE: edited record {target[:8]} → chain check said {report}: NOT caught at that row")
    return 1


def delete(hubs, hub_id, args) -> int:
    db = hubs.db(hub_id)
    target = newest_own(db, hub_id)
    with sqlite3.connect(db) as con:
        con.execute("DELETE FROM events WHERE id = ?", (target,))
    report = verify(hubs, hub_id)
    flagged = report["first_bad_event"] == target
    print(f"DIRECTORATE: deleted {hub_id}'s newest record {target[:8]} → chain check "
          f"{'names it as missing' if flagged else f'said {report}'}")
    if not hubs.others(hub_id):
        return 0 if flagged else 1
    end = time.time() + args.wait
    while time.time() < end:
        if target in hubs.client.get(f"{hubs.url(hub_id)}/sync/ids").json()["ids"]:
            print(f"  the other hub put it back. {hubs.summary(hub_id)}")
            return 0 if flagged and verify(hubs, hub_id)["chain_intact"] else 1
        time.sleep(0.2)
    print(f"  not back after {args.wait:g} s (is the link cut? restore it). {hubs.summary(hub_id)}")
    return 1


def link(hubs, hub_id, cut: bool) -> int:
    status = hubs.client.post(f"{hubs.url(hub_id)}/link", json={"cut": cut}).json()
    if cut:
        print(f"DIRECTORATE: cut {hub_id}'s link → alerts wait on {hub_id} ({status['queued']} waiting now)")
    else:
        print(f"REBELS: restored {hub_id}'s link → {status['queued']} waiting alerts cross now")
    return 0 if status["cut"] == cut else 1


def status(hubs, hub_id, args) -> int:
    for h in (hubs.urls or {hub_id: None}):
        s = hubs.client.get(f"{hubs.url(h)}/sync/status").json()
        agree = ", ".join(f"{'agrees' if v else 'differs' if v is False else 'unknown'}" for v in s["agrees_with"].values())
        print(f"{hubs.summary(h)} {s['link']['queued']} waiting to send, link {'cut' if s['link']['cut'] else 'up'}, "
              f"with the other hub: {agree or 'no peer'}")
    return 0


def revoke_demo(hubs, hub_id, args) -> int:
    member = roster_tool.load_key(args.member)
    operator = roster_tool.load_key(args.operator)
    pub = crypto.public_key(member)
    targets = [hub_id, *hubs.others(hub_id)]

    def alert(h):
        level = int(h.split("L")[-1])
        return crypto.sign({
            "id": str(uuid.uuid4()), "type": "checkin", "hub_id": h, "level": level, "created_at": now_iso(),
            "author": "phone", "payload": {"status": "ok", "note": "checking in"},
        }, member)

    code, said = post(hubs, hub_id, alert(hub_id))
    print(f"MEMBER: a valid check-in from the phone → {hub_id}: {said}")
    if code != 201:
        print("  the phone has to be on the roster first: scripts/roster_tool.py add <its key> ...")
        return 1
    hub = hubs.client.get(f"{hubs.url(hub_id)}/health").json()
    r = hubs.client.post(f"{hubs.url(hub_id)}/roster", json=roster_tool.roster_event(hub, operator, "remove", pub, "member"))
    if r.status_code != 201:
        print(f"OPERATOR: revoke refused: {r.json().get('detail')}")
        return 1
    print(f"OPERATOR: phone reported stolen → its key is revoked on {hub_id}; the roster change syncs")
    ok = True
    for h in targets:
        end, slipped = time.time() + args.wait, 0
        while True:
            code, said = post(hubs, h, alert(h))
            if code == 403 or time.time() > end:
                break
            slipped += 1  # the revocation hasn't reached this hub yet
            time.sleep(0.3)
        late = f" ({slipped} accepted before the revocation reached {h})" if slipped else ""
        print(f"THIEF: the stolen phone tries again → {h}: {'refused, ' + said if code == 403 else 'ACCEPTED'}{late}")
        ok &= code == 403
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=("forge", "replay", "tamper", "edit", "delete", "cut", "restore", "status", "revoke-demo"))
    ap.add_argument("--at", choices=tuple(NAMES), help="which hub (default L12; cut/restore default L34)")
    ap.add_argument("--hub", help="a hub URL not started by demo_hubs.py")
    ap.add_argument("--db", help="that hub's database file (edit, delete)")
    ap.add_argument("--dir", default=str(Path(demo_hubs.HUB_DIR) / "demo" / "run"), help="demo_hubs.py --dir")
    ap.add_argument("--note", default="All clear, go home", help="what the forged message says")
    ap.add_argument("--id", help="edit: which record (default: the hub's newest)")
    ap.add_argument("--member", help="revoke-demo: the phone's key file")
    ap.add_argument("--operator", help="revoke-demo: the operator's key file")
    ap.add_argument("--wait", type=float, default=15, help="seconds to wait for sync")
    args = ap.parse_args(argv)
    if args.cmd == "revoke-demo" and not (args.member and args.operator):
        ap.error("revoke-demo needs --member and --operator")

    hubs = Hubs(args)
    default = "L34" if args.cmd in ("cut", "restore") else "L12"
    try:
        hub_id = hubs.hub_id(NAMES[args.at or default])  # with --hub: whatever that hub calls itself
        if args.cmd in ("cut", "restore"):
            return link(hubs, hub_id, args.cmd == "cut")
        return {"forge": forge, "replay": replay, "tamper": tamper, "edit": edit, "delete": delete,
                "status": status, "revoke-demo": revoke_demo}[args.cmd](hubs, hub_id, args)
    except httpx.HTTPError as err:
        print(f"can't reach the hub ({err.__class__.__name__}): is it running?", file=sys.stderr)
        return 1
    finally:
        hubs.client.close()


if __name__ == "__main__":
    sys.exit(main())
