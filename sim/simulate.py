"""The simulated Hollow: signed canaries and residents on other levels (Alanna's workstream;
written by Michael while she's out).

Plays sim/world.json's crisis timeline against the two demo hubs: water rises on L35,
contaminated water reaches L34's taps, the L34 market fan stalls, and the L12 relay's
voltage sags. Each simulated canary and resident has its own Ed25519 key, preloaded on
the roster through ROSTER_FILE, so every event arrives signed and shows as verified.
Each event goes to the hub that serves its level (L31-40 → hub-L34, L1-30 → hub-L12)
and syncs to the other one by itself. Tisya's real box (canary-34) is never simulated.
Every event carries "simulated": true in its signed payload, and the console and map
label it, so a simulated box is never mistaken for the real one.

Run from the repo root with the hub's Python (it needs httpx and pynacl):

    # 1. Keys for every simulated sender (sim/keys/*.key, ignored by git; kept between runs)
    hub/.venv/bin/python sim/simulate.py keys

    # 2. A roster with the operator, the sim's keys, and any real members (box, phones)
    hub/.venv/bin/python hub/scripts/roster_tool.py new-key --out hub/demo/operator.key   # once
    hub/.venv/bin/python sim/simulate.py roster --operator hub/demo/operator.key \\
        --member <canary-34 public key>:canary-34 --out hub/demo/roster.json

    # 3. Hubs that require signing, then the crisis (3 minutes by default)
    cd hub && .venv/bin/python scripts/demo_hubs.py up --signed --roster demo/roster.json && cd ..
    hub/.venv/bin/python sim/simulate.py run
    hub/.venv/bin/python sim/simulate.py run --minutes 1      # faster
    hub/.venv/bin/python sim/simulate.py run --dry-run        # print the schedule only

    # The hidden truth and the Directorate's claims, for scoring and the map
    hub/.venv/bin/python sim/simulate.py truth

If the hubs don't have the sim's keys on their roster but still allow unsigned posts
(REQUIRE_SIGNED=0), `run` posts unsigned and says so: the events show as not verified.
If they require signing, it stops before sending anything.

Hub URLs come from demo_hubs.py's state file (hub/demo/run/hubs.json); override with
--hub hub-L34=http://10.0.0.5:8001 --hub hub-L12=http://10.0.0.6:8002.
"""

import argparse
import json
import math
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SIM = ROOT / "sim"
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(ROOT / "hub" / "scripts"))

import demo_hubs  # noqa: E402
import roster_tool  # noqa: E402
from app import crypto  # noqa: E402
from app.forecast import eta_for  # noqa: E402

NOMINAL_S = 180  # the timeline's times are seconds at --minutes 3


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_world(path: Path) -> dict:
    world = json.loads(path.read_text())
    check_world(world)
    return world


def actors(world: dict) -> dict[str, dict]:
    """Every simulated sender by id: canaries by device_id, residents by id."""
    out = {c["device_id"]: {**c, "kind": "canary", "id": c["device_id"], "handle": c["device_id"]} for c in world["canaries"]}
    out.update({r["id"]: {**r, "kind": "resident"} for r in world["residents"]})
    return out


def hub_for(world: dict, level: int) -> str:
    for h in world["hubs"]:
        lo, hi = h["serves"]
        if lo <= level <= hi:
            return h["hub_id"]
    raise ValueError(f"no hub serves level {level}")


def check_world(world: dict) -> None:
    """Catch mistakes in world.json before anything is sent."""
    who = actors(world)
    real = set(world.get("real_boxes", []))
    if clash := real & {c["device_id"] for c in world["canaries"]}:
        raise SystemExit(f"world.json simulates a real box: {sorted(clash)}")
    last = -1
    for i, step in enumerate(world["timeline"]):
        where = f"timeline[{i}]"
        if step["by"] not in who:
            raise SystemExit(f"{where}: unknown sender {step['by']!r}")
        if step["type"] not in ("checkin", "hazard", "case", "missing_person"):
            raise SystemExit(f"{where}: type {step['type']!r} isn't one a phone or box sends")
        if step["t"] < last:
            raise SystemExit(f"{where}: times must not go backwards")
        last = step["t"]
        if _has_float(step["payload"]):
            raise SystemExit(f"{where}: floats in a payload (Python and JS print some differently, so signatures break)")
        hub_for(world, who[step["by"]]["level"])


def _has_float(v) -> bool:
    if isinstance(v, float):
        return True
    if isinstance(v, dict):
        return any(_has_float(x) for x in v.values())
    if isinstance(v, list):
        return any(_has_float(x) for x in v)
    return False


def key_path(keys: Path, actor_id: str) -> Path:
    return keys / f"{actor_id}.key"


def make_event(world: dict, step: dict, created_at: str | None = None) -> dict:
    """The unsigned event for one timeline step, addressed to the hub serving its level."""
    a = actors(world)[step["by"]]
    e = {
        "id": str(uuid.uuid4()), "type": step["type"], "hub_id": hub_for(world, a["level"]), "level": a["level"],
        "created_at": created_at or now_iso(), "author": a["handle"],
        # Inside the signed payload, so the "simulated" label can't be added or stripped by anyone else.
        "payload": {**step["payload"], "simulated": True},
    }
    if a["kind"] == "canary":
        e["source"], e["device_id"] = "sensor", a["device_id"]
    return e


# ---------------------------------------------------------------- commands

def cmd_keys(args) -> int:
    world, keys = load_world(Path(args.world)), Path(args.keys)
    made = 0
    for aid in actors(world):
        p = key_path(keys, aid)
        if not p.exists():
            roster_tool.write_key(p)
            made += 1
    print(f"keys: {made} new, {len(actors(world)) - made} kept, in {keys}")
    return 0


def cmd_roster(args) -> int:
    world, keys = load_world(Path(args.world)), Path(args.keys)
    missing = [aid for aid in actors(world) if not key_path(keys, aid).exists()]
    if missing:
        raise SystemExit(f"no key for {', '.join(missing)}: run `simulate.py keys` first")
    entries = [roster_tool.member_entry(o, "operator") for o in args.operator]
    entries += [roster_tool.member_entry(str(key_path(keys, aid))) | {"name": aid} for aid in actors(world)]
    entries += [roster_tool.member_entry(m) for m in args.member]
    pubs = [e["pub"] for e in entries]
    if len(set(pubs)) != len(pubs):
        raise SystemExit("the same key is listed twice")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(entries, indent=2) + "\n")
    ops = sum(e["role"] == "operator" for e in entries)
    print(f"wrote {args.out}: {ops} operator(s), {len(actors(world))} simulated senders, {len(args.member)} other member(s)")
    return 0


def hub_urls(args, world: dict) -> dict[str, str]:
    urls = {h["hub_id"]: f"http://127.0.0.1:{h['port']}" for h in demo_hubs.read_state(Path(args.dir)).get("hubs", [])}
    for spec in args.hub or []:
        hub_id, _, url = spec.partition("=")
        if not url:
            raise SystemExit(f"--hub wants hub-ID=URL, got {spec!r}")
        urls[hub_id] = url.rstrip("/")
    needed = {h["hub_id"] for h in world["hubs"]}
    if missing := needed - set(urls):
        raise SystemExit(f"no URL for {sorted(missing)}: start scripts/demo_hubs.py up, or pass --hub {sorted(missing)[0]}=URL")
    return urls


def cmd_run(args) -> int:
    world, keys = load_world(Path(args.world)), Path(args.keys)
    scale = args.minutes * 60 / NOMINAL_S
    steps = world["timeline"]
    who = actors(world)

    if args.dry_run:
        for s in steps:
            a = who[s["by"]]
            print(f"t+{s['t'] * scale:6.1f}s  L{a['level']:<2} {s['by']:<17} {s['type']:<14} → {hub_for(world, a['level'])}  {_gist(s)}")
        print(f"{len(steps)} events over {args.minutes:g} min")
        return 0

    urls = hub_urls(args, world)
    loaded = {aid: roster_tool.load_key(str(key_path(keys, aid))) for aid in who if key_path(keys, aid).exists()}
    client = httpx.Client(timeout=10)
    sign_on: dict[str, bool] = {}
    for hub_id, url in urls.items():
        try:
            roster = client.get(f"{url}/roster").json()
            health = client.get(f"{url}/health").json()
        except httpx.HTTPError as err:
            raise SystemExit(f"{hub_id} at {url} isn't answering ({err.__class__.__name__})")
        if health["hub_id"] != hub_id:
            raise SystemExit(f"{url} is {health['hub_id']}, not {hub_id}")
        members = {m["pub"] for m in roster["members"]}
        on = all(aid in loaded and crypto.public_key(loaded[aid]) in members for aid in who if hub_for(world, who[aid]["level"]) == hub_id)
        if not on and roster["require_signed"]:
            raise SystemExit(f"{hub_id} requires signing and the sim's keys aren't on its roster: run `simulate.py keys` and "
                             f"`simulate.py roster`, then restart the hubs with demo_hubs.py up --signed --roster ...")
        sign_on[hub_id] = on
        if not on:
            print(f"note: the sim's keys aren't on {hub_id}'s roster; posting unsigned there (shows as not verified)")

    print(f"run: {len(steps)} events over {args.minutes:g} min → " + ", ".join(f"{h} {u}" for h, u in urls.items()))
    for p in world["phases"]:
        print(f"  t+{p['start_s'] * scale:5.0f}s  {p['says']}")
    start = time.monotonic()
    sent = {"stored": 0, "refused": 0, "unreachable": 0}
    sent_volts: dict[str, list[tuple[float, float]]] = {}  # per box: (unix time, volts) it has sent
    log = []
    for s in steps:
        wait = start + s["t"] * scale - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        e = make_event(world, s)
        add_countdown(e, sent_volts)
        hub_id = e["hub_id"]
        signed = sign_on[hub_id]
        body = crypto.sign(e, loaded[s["by"]]) if signed else {k: e[k] for k in ("type", "level", "author", "payload", "source", "device_id") if k in e}
        try:
            r = client.post(f"{urls[hub_id]}/events", json=body)
            outcome = "stored" if r.status_code == 201 else "refused"
            detail = "" if r.status_code == 201 else f" ({r.status_code}: {_detail(r)})"
        except httpx.HTTPError as err:
            outcome, detail = "unreachable", f" ({err.__class__.__name__})"
        sent[outcome] += 1
        log.append({"t": s["t"], "by": s["by"], "type": s["type"], "hub": hub_id, "outcome": outcome})
        mark = {"stored": "✓", "refused": "✗", "unreachable": "…"}[outcome]
        print(f"t+{time.monotonic() - start:6.1f}s {mark} L{e['level']:<2} {s['by']:<17} {s['type']:<14} → {hub_id}"
              f"{' signed' if signed else ' unsigned'}{detail}  {_gist(s)}")
    print(f"done: {sent['stored']} stored, {sent['refused']} refused, {sent['unreachable']} unreachable")
    write_truth(world, Path(args.truth_dir), log)
    return 0 if sent["refused"] == 0 and sent["unreachable"] == 0 else 1


def add_countdown(e: dict, sent_volts: dict[str, list[tuple[float, float]]]) -> None:
    """A box that reports volts remembers what it sent. A blackout warning from it carries
    expected_in_min worked out by the same forecast the hub runs (hub/app/forecast.py) on
    those readings, so the map's countdown and GET /forecast agree. Changes e in place."""
    reading = e["payload"].get("reading")
    if not e.get("device_id") or not isinstance(reading, dict) or reading.get("unit") != "V":
        return
    history = sent_volts.setdefault(e["device_id"], [])
    history.append((time.time(), float(reading["value"])))
    if e["payload"].get("kind") == "blackout":
        status, eta, *_ = eta_for(history)
        if status == "falling" and eta is not None:
            e["payload"] = {**e["payload"], "expected_in_min": max(1, math.ceil(eta / 60))}


def _gist(step: dict) -> str:
    p = step["payload"]
    return str(p.get("note") or p.get("raw_text") or p.get("description") or p.get("status") or p.get("kind") or "")[:60]


def _detail(r: httpx.Response) -> str:
    try:
        return str(r.json().get("detail"))
    except ValueError:
        return r.text[:80]


def write_truth(world: dict, out: Path, log: list[dict] | None = None) -> None:
    """sim/ground_truth/: what's really happening, what was reported, what the Directorate claims."""
    out.mkdir(parents=True, exist_ok=True)
    who = actors(world)
    steps = world["timeline"] if log is None else [s for s, l in zip(world["timeline"], log) if l["outcome"] == "stored"]
    reported: dict[str, dict[str, int]] = {}
    for s in steps:
        if s["type"] != "case":
            continue
        lvl = str(who[s["by"]]["level"])
        syms = " ".join(s["payload"].get("symptoms", []))
        kind = "lungs" if any(w in syms for w in ("cough", "breath")) else "water"
        reported.setdefault(lvl, {"water": 0, "lungs": 0})[kind] += s["payload"].get("people_affected", 1)
    gt = world["ground_truth"]
    truth = {
        "_note": gt["_note"],
        "reported_from": "the last `simulate.py run`" if log is not None else "the whole timeline (no run)",
        "true_cases": gt["true_cases"],
        "reported_cases": reported,
        "cause": gt["cause"],
    }
    (out / "truth.json").write_text(json.dumps(truth, indent=2, ensure_ascii=False) + "\n")
    d = {k: v for k, v in world["directorate"].items() if k != "_note"}
    d["_note"] = "The Directorate's official (falsified) figures. Compare with truth.json."
    (out / "directorate.json").write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out / 'truth.json'} and {out / 'directorate.json'}")


def cmd_truth(args) -> int:
    write_truth(load_world(Path(args.world)), Path(args.truth_dir))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--world", default=str(SIM / "world.json"))
    ap.add_argument("--keys", default=str(SIM / "keys"), help="where the simulated senders' key files live")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("keys", help="make a key for every simulated sender (keeps existing ones)")

    r = sub.add_parser("roster", help="write a ROSTER_FILE: operator(s) + the sim's keys + other members")
    r.add_argument("--operator", action="append", required=True, help="operator key file or public key (repeatable)")
    r.add_argument("--member", action="append", default=[], help="another member: public key or key file, optionally :name")
    r.add_argument("--out", required=True)

    run = sub.add_parser("run", help="play the crisis timeline against the hubs")
    run.add_argument("--minutes", type=float, default=3.0, help="how long the whole timeline takes (default 3)")
    run.add_argument("--hub", action="append", help="hub-ID=URL, overrides the demo_hubs state file (repeatable)")
    run.add_argument("--dir", default=str(ROOT / "hub" / "demo" / "run"), help="demo_hubs.py --dir")
    run.add_argument("--dry-run", action="store_true", help="print the schedule, send nothing")
    run.add_argument("--truth-dir", default=str(SIM / "ground_truth"))

    t = sub.add_parser("truth", help="write sim/ground_truth/ from world.json only")
    t.add_argument("--truth-dir", default=str(SIM / "ground_truth"))

    args = ap.parse_args(argv)
    if args.cmd == "run" and args.minutes <= 0:
        raise SystemExit("--minutes must be more than 0")
    return {"keys": cmd_keys, "roster": cmd_roster, "run": cmd_run, "truth": cmd_truth}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
