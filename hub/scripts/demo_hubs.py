"""Start, reset and stop the two demo hubs together, so their databases never drift apart.

    cd hub
    .venv/bin/python scripts/demo_hubs.py up                  # hub-L34 on :8001, hub-L12 on :8002, synced
    .venv/bin/python scripts/demo_hubs.py up --signed --roster demo/roster.json
    .venv/bin/python scripts/demo_hubs.py status
    .venv/bin/python scripts/demo_hubs.py reset               # wipe BOTH databases, start again
    .venv/bin/python scripts/demo_hubs.py down

Why reset wipes both: if only one hub's database is wiped, the other still holds the
old events of the wiped hub, and the wiped hub can't prove it wrote them. It refuses
them (once each, so the "forgeries blocked" counter jumps by that many) and its new
chain starts over. Wiping both keeps every rehearsal clean.

It only starts hubs; it adds no events. Filling them is sim/simulate.py (Alanna's).
Databases, logs and process ids live in --dir (default hub/demo/run, ignored by git).
Use --host 0.0.0.0 so phones on the same Wi-Fi can reach the hubs; `up` then prints the
link to open on a phone (http://<laptop-ip>:3000/?hub=http://<laptop-ip>:8001).
"""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

HUB_DIR = Path(__file__).resolve().parents[1]
HUBS = (("hub-L34", 0), ("hub-L12", 1))  # (id, index into --ports)


def port_open(host: str, port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1" if host == "0.0.0.0" else host, port)) == 0


def state_file(run: Path) -> Path:
    return run / "hubs.json"


def read_state(run: Path) -> dict:
    try:
        return json.loads(state_file(run).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def alive(pid: int) -> bool:
    try:  # reap it first if it's our own child that already exited
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    except ChildProcessError:
        pass
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def signal_group(pid: int, sig: int) -> None:
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def up(args) -> int:
    run = Path(args.dir)
    run.mkdir(parents=True, exist_ok=True)
    if any(alive(h["pid"]) for h in read_state(run).get("hubs", [])):
        print(f"demo hubs already running (see {state_file(run)}); run `down` or `reset` first", file=sys.stderr)
        return 1
    ports = args.ports
    if busy := [p for p in ports if port_open(args.host, p)]:
        print(f"port(s) {busy} already in use. Stop whatever runs there, or pick others with --ports", file=sys.stderr)
        return 1
    if args.signed and not args.roster:
        print("--signed needs --roster (who may post); make one with scripts/roster_tool.py file", file=sys.stderr)
        return 1
    roster = str(Path(args.roster).resolve()) if args.roster else ""
    local = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    hubs = []
    for hub_id, i in HUBS:
        peer = ports[1 - i]
        env = {
            **os.environ,
            "HUB_ID": hub_id,
            "HUB_DB": str((run / f"{hub_id}.db").resolve()),
            "HUB_PEERS": f"http://{local}:{peer}",
            "REQUIRE_SIGNED": "1" if args.signed else "0",
            "ROSTER_FILE": roster,
            "TRIAGE_ON_INGEST": os.environ.get("TRIAGE_ON_INGEST", "0"),
        }
        log = open(run / f"{hub_id}.log", "a")
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", args.host, "--port", str(ports[i]),
             "--log-level", "warning"],
            cwd=HUB_DIR, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        hubs.append({"hub_id": hub_id, "port": ports[i], "pid": proc.pid})
    state_file(run).write_text(json.dumps({"hubs": hubs, "signed": args.signed, "roster": roster}, indent=2))

    end = time.time() + 30
    with httpx.Client(timeout=2) as client:
        for h in hubs:
            while True:
                try:
                    if client.get(f"http://{local}:{h['port']}/health").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if time.time() > end:
                    print(f"{h['hub_id']} didn't start; see {run / (h['hub_id'] + '.log')}", file=sys.stderr)
                    down(args)
                    return 1
                time.sleep(0.2)
    a, b = (f"http://{local}:{h['port']}" for h in hubs)
    print(f"up: hub-L34 {a}, hub-L12 {b}, synced, signing {'required' if args.signed else 'optional'}")
    print(f"console: http://localhost:3000/dashboard?hub={b}&peer={a}")
    if args.host == "0.0.0.0":
        ip = lan_ip()
        print(f"phones on this Wi-Fi: http://{ip}:3000/?hub=http://{ip}:{hubs[0]['port']}  (posts to hub-L34; remembered on the phone)")
    return 0


def lan_ip() -> str:
    """This machine's address on the local network (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "<laptop-ip>"


def down(args) -> int:
    run = Path(args.dir)
    hubs = read_state(run).get("hubs", [])
    for h in hubs:
        if alive(h["pid"]):
            signal_group(h["pid"], signal.SIGTERM)
    end = time.time() + 5
    for h in hubs:
        while alive(h["pid"]) and time.time() < end:
            time.sleep(0.1)
        if alive(h["pid"]):  # an open live feed keeps uvicorn waiting
            signal_group(h["pid"], signal.SIGKILL)
    state_file(run).unlink(missing_ok=True)
    print(f"down: stopped {len(hubs)} hub(s)" if hubs else "down: no demo hubs were running")
    return 0


def reset(args) -> int:
    state = read_state(Path(args.dir))
    down(args)
    run = Path(args.dir)
    for hub_id, _ in HUBS:
        for suffix in (".db", ".db-journal", ".db-wal", ".db-shm"):
            (run / f"{hub_id}{suffix}").unlink(missing_ok=True)
    print("reset: wiped both databases")
    # keep the previous signing setup unless the command line changes it
    args.signed = args.signed or state.get("signed", False)
    args.roster = args.roster or state.get("roster") or None
    return up(args)


def status(args) -> int:
    hubs = read_state(Path(args.dir)).get("hubs", [])
    if not hubs:
        print("no demo hubs running")
        return 1
    local = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    with httpx.Client(timeout=2) as client:
        for h in hubs:
            url = f"http://{local}:{h['port']}"
            try:
                health = client.get(f"{url}/health").json()
                sync = client.get(f"{url}/sync/status").json()
                rejected = client.get(f"{url}/rejected?limit=1").json()["total"]
                print(f"{h['hub_id']} {url}: {health['events']} events, chain intact {health['chain_intact']}, "
                      f"{rejected} refused, {sync['link']['queued']} waiting to send, "
                      f"link {'cut' if sync['link'].get('cut') else 'up'}, {sync['restored']} rows restored, "
                      f"fingerprint {sync['fingerprint']}")
                agree = list(sync["agrees_with"].values())
                print(f"  hubs agree: {'yes' if agree and all(agree) else 'no' if False in agree else 'unknown (link cut or peer silent)'}")
            except httpx.HTTPError as err:
                print(f"{h['hub_id']} {url}: not answering ({err.__class__.__name__})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=("up", "down", "reset", "status"))
    ap.add_argument("--signed", action="store_true", help="REQUIRE_SIGNED=1 (needs --roster)")
    ap.add_argument("--roster", help="ROSTER_FILE for both hubs")
    ap.add_argument("--ports", type=int, nargs=2, default=[8001, 8002], metavar=("L34", "L12"))
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to let phones on the Wi-Fi in")
    ap.add_argument("--dir", default=str(HUB_DIR / "demo" / "run"))
    args = ap.parse_args(argv)
    return {"up": up, "down": down, "reset": reset, "status": status}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
