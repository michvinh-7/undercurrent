"""The operator's side of the roster: keys, the demo roster file, and adding or removing members.

Joining happens in person: an operator takes a member's public key (their QR code) and
adds it with an operator-signed roster event, which syncs to every hub. For the demo,
the keys are preloaded instead through ROSTER_FILE.

    cd hub
    # 1. Make the operator's key (keep the file private; *.key is in .gitignore)
    .venv/bin/python scripts/roster_tool.py new-key --out demo/operator.key

    # 2. Write the demo roster: the operator plus each member's public key
    #    (a base64 key, or a .key file), optionally with a name after a colon
    .venv/bin/python scripts/roster_tool.py file --operator demo/operator.key \
        --member <canary-34 public key>:canary-34 --member demo/sim-L12.key:sim-L12 \
        --out demo/roster.json
    # then start each hub with ROSTER_FILE=demo/roster.json (scripts/demo_hubs.py does it)

    # 3. On the day: add a new member, or remove a stolen phone, on a running hub
    .venv/bin/python scripts/roster_tool.py add    <public key> --hub http://localhost:8001 --operator demo/operator.key
    .venv/bin/python scripts/roster_tool.py remove <public key> --hub http://localhost:8001 --operator demo/operator.key

    # Who's on it now
    .venv/bin/python scripts/roster_tool.py show --hub http://localhost:8001

A key file is JSON: {"seed": <base64 32-byte seed>, "pub": <base64 public key>}. The
seed is what crypto.key_from_b64() takes, so the box and the sim can load the same file.
"""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import crypto  # noqa: E402


def write_key(path: Path) -> dict:
    key = crypto.new_key()
    data = {"seed": crypto.b64(bytes(key)), "pub": crypto.public_key(key)}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # never overwrite a key
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return data


def load_key(path: str):
    data = json.loads(Path(path).read_text())
    key = crypto.key_from_b64(data["seed"])
    if crypto.public_key(key) != data.get("pub", crypto.public_key(key)):
        raise SystemExit(f"{path}: the seed and pub don't match")
    return key


def public_key_of(text: str) -> str:
    """A public key given as base64, or the pub of a .key file."""
    if Path(text).is_file():
        return json.loads(Path(text).read_text())["pub"]
    try:
        if len(crypto.unb64(text)) == 32:
            return text
    except ValueError:
        pass
    raise SystemExit(f"not a public key or a key file: {text}")


def member_entry(spec: str, role: str = "member") -> dict:
    key, _, name = spec.partition(":") if not Path(spec).is_file() else (spec, "", "")
    entry = {"pub": public_key_of(key), "role": role}
    if name:
        entry["name"] = name
    return entry


def roster_event(hub: dict, operator, action: str, pub: str, role: str) -> dict:
    hub_id = hub["hub_id"]
    level = int(m.group(1)) if (m := re.search(r"L(\d+)", hub_id)) else 1
    payload = {"action": action, "pub": pub}
    if action == "add":
        payload["role"] = role
    return crypto.sign({
        "id": str(uuid.uuid4()), "type": "roster", "hub_id": hub_id, "level": level,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "author": "operator", "payload": payload,
    }, operator)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    k = sub.add_parser("new-key", help="make a keypair file (operator, box or simulated sender)")
    k.add_argument("--out", required=True)

    f = sub.add_parser("file", help="write a ROSTER_FILE for the demo")
    f.add_argument("--operator", action="append", required=True, help="operator key file or public key (repeatable)")
    f.add_argument("--member", action="append", default=[], help="public key or key file, optionally :name (repeatable)")
    f.add_argument("--out", required=True)

    for name in ("add", "remove"):
        c = sub.add_parser(name, help=f"{name} a member on a running hub (operator-signed, syncs to every hub)")
        c.add_argument("pub", help="public key or key file")
        c.add_argument("--hub", required=True, help="hub URL, e.g. http://localhost:8001")
        c.add_argument("--operator", required=True, help="operator key file")
        if name == "add":
            c.add_argument("--role", choices=("member", "operator"), default="member")

    s = sub.add_parser("show", help="print a hub's roster")
    s.add_argument("--hub", required=True)

    args = ap.parse_args(argv)

    if args.cmd == "new-key":
        try:
            data = write_key(Path(args.out))
        except FileExistsError:
            raise SystemExit(f"{args.out} already exists; not overwriting a key")
        print(f"wrote {args.out}\npublic key: {data['pub']}")
        return 0

    if args.cmd == "file":
        entries = [member_entry(o, "operator") for o in args.operator] + [member_entry(m) for m in args.member]
        pubs = [e["pub"] for e in entries]
        if len(set(pubs)) != len(pubs):
            raise SystemExit("the same key is listed twice")
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(entries, indent=2) + "\n")
        print(f"wrote {args.out}: {sum(e['role'] == 'operator' for e in entries)} operator(s), "
              f"{sum(e['role'] == 'member' for e in entries)} member(s)")
        return 0

    with httpx.Client(timeout=10) as client:
        url = args.hub.rstrip("/")
        if args.cmd == "show":
            print(json.dumps(client.get(f"{url}/roster").json(), indent=2))
            return 0
        hub = client.get(f"{url}/health").json()
        event = roster_event(hub, load_key(args.operator), args.cmd, public_key_of(args.pub), getattr(args, "role", "member"))
        r = client.post(f"{url}/roster", json=event)
        if r.status_code != 201:
            print(f"refused ({r.status_code}): {r.json().get('detail', r.text)}", file=sys.stderr)
            return 1
        print(f"{args.cmd}: {event['payload']['pub']} on {hub['hub_id']} (event {event['id']}); it syncs to the other hubs")
        return 0


if __name__ == "__main__":
    sys.exit(main())
