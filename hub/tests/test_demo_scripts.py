"""The demo scripts against real hub processes: scripts/roster_tool.py and scripts/demo_hubs.py.

Starts two uvicorn hubs on free ports in a temp folder (a few seconds), so this also
covers sync over HTTP: a deleted row coming back, and the counter not climbing.
"""

import json
import socket
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

HUB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HUB / "scripts"))

import demo_hubs  # noqa: E402
import roster_tool  # noqa: E402
from app import crypto  # noqa: E402


def free_ports(n):
    socks = [socket.socket() for _ in range(n)]
    for s in socks:
        s.bind(("127.0.0.1", 0))
    ports = [s.getsockname()[1] for s in socks]
    for s in socks:
        s.close()
    return ports


def alert(hub_id, key, level=34, note="water"):
    return crypto.sign({
        "id": str(uuid.uuid4()), "type": "hazard", "hub_id": hub_id, "level": level,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "author": "canary-34", "source": "sensor", "payload": {"kind": "flooding", "severity": "high", "note": note},
    }, key)


def wait_for(check, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return True
        time.sleep(0.2)
    return False


# ---------------------------------------------------------------- roster_tool, offline parts

def test_new_key_file_loads_and_is_never_overwritten(tmp_path):
    out = tmp_path / "op.key"
    assert roster_tool.main(["new-key", "--out", str(out)]) == 0
    data = json.loads(out.read_text())
    assert crypto.public_key(roster_tool.load_key(str(out))) == data["pub"]
    assert out.stat().st_mode & 0o777 == 0o600
    with pytest.raises(SystemExit, match="already exists"):
        roster_tool.main(["new-key", "--out", str(out)])
    assert json.loads(out.read_text()) == data


def test_roster_file_from_keys_and_public_keys(tmp_path):
    op, box = tmp_path / "op.key", tmp_path / "box.key"
    roster_tool.main(["new-key", "--out", str(op)])
    roster_tool.main(["new-key", "--out", str(box)])
    phone = crypto.public_key(crypto.new_key())
    out = tmp_path / "roster.json"
    assert roster_tool.main(["file", "--operator", str(op), "--member", f"{box}:canary-34",
                             "--member", f"{phone}:phone-1", "--out", str(out)]) == 0
    entries = json.loads(out.read_text())
    assert entries == [
        {"pub": json.loads(op.read_text())["pub"], "role": "operator"},
        {"pub": json.loads(box.read_text())["pub"], "role": "member", "name": "canary-34"},
        {"pub": phone, "role": "member", "name": "phone-1"},
    ]
    with pytest.raises(SystemExit, match="twice"):
        roster_tool.main(["file", "--operator", str(op), "--member", str(op), "--out", str(out)])
    with pytest.raises(SystemExit, match="not a public key"):
        roster_tool.main(["file", "--operator", str(op), "--member", "nonsense", "--out", str(out)])


# ---------------------------------------------------------------- both scripts against real hubs

@pytest.fixture
def demo(tmp_path):
    """Two signed demo hubs, an operator, a roster with one member (the box)."""
    op, box = tmp_path / "op.key", tmp_path / "box.key"
    roster_tool.main(["new-key", "--out", str(op)])
    roster_tool.main(["new-key", "--out", str(box)])
    roster_tool.main(["file", "--operator", str(op), "--member", str(box), "--out", str(tmp_path / "roster.json")])
    ports = free_ports(2)
    base = ["--ports", *map(str, ports), "--dir", str(tmp_path / "run")]
    assert demo_hubs.main(["up", "--signed", "--roster", str(tmp_path / "roster.json"), *base]) == 0
    urls = [f"http://127.0.0.1:{p}" for p in ports]
    client = httpx.Client(timeout=5)
    yield {"tmp": tmp_path, "op": op, "box": roster_tool.load_key(str(box)), "urls": urls, "base": base,
           "client": client, "run": tmp_path / "run"}
    client.close()
    demo_hubs.main(["down", *base])


def test_up_refuses_ports_in_use_and_a_second_start(demo):
    assert demo_hubs.main(["up", *demo["base"]]) == 1  # already running
    assert demo_hubs.main(["status", *demo["base"]]) == 0


def test_signed_alert_syncs_and_unsigned_is_refused(demo):
    c, (l34, l12) = demo["client"], demo["urls"]
    e = alert("hub-L34", demo["box"])
    assert c.post(f"{l34}/events", json=e).status_code == 201
    assert wait_for(lambda: e["id"] in c.get(f"{l12}/sync/ids").json()["ids"])
    unsigned = {"type": "hazard", "level": 34, "author": "x", "payload": {"kind": "flooding", "severity": "low"}}
    assert c.post(f"{l34}/events", json=unsigned).status_code == 403


def test_roster_add_and_remove_a_phone_on_running_hubs(demo):
    c, (l34, l12) = demo["client"], demo["urls"]
    phone = crypto.new_key()
    pub = crypto.public_key(phone)
    assert c.post(f"{l34}/events", json=alert("hub-L34", phone)).status_code == 403  # not on the roster
    assert roster_tool.main(["add", pub, "--hub", l34, "--operator", str(demo["op"])]) == 0
    assert c.post(f"{l34}/events", json=alert("hub-L34", phone)).status_code == 201
    # the roster event syncs: the other hub accepts the phone too
    assert wait_for(lambda: any(m["pub"] == pub for m in c.get(f"{l12}/roster").json()["members"]))
    assert c.post(f"{l12}/events", json=alert("hub-L12", phone, level=12)).status_code == 201
    # stolen phone: one removal on one hub, refused on both
    assert roster_tool.main(["remove", pub, "--hub", l34, "--operator", str(demo["op"])]) == 0
    assert c.post(f"{l34}/events", json=alert("hub-L34", phone)).status_code == 403
    assert wait_for(lambda: c.post(f"{l12}/events", json=alert("hub-L12", phone, level=12)).status_code == 403)


def test_only_an_operator_can_change_the_roster(demo, tmp_path):
    stranger = tmp_path / "stranger.key"
    roster_tool.main(["new-key", "--out", str(stranger)])
    pub = crypto.public_key(crypto.new_key())
    assert roster_tool.main(["add", pub, "--hub", demo["urls"][0], "--operator", str(stranger)]) == 1


def test_deleted_row_comes_back_over_http_and_the_counter_stays_still(demo):
    c, (l34, l12) = demo["client"], demo["urls"]
    sent = [alert("hub-L34", demo["box"], note=f"n{i}") for i in range(3)]
    for e in sent:
        assert c.post(f"{l34}/events", json=e).status_code == 201
    assert wait_for(lambda: {e["id"] for e in sent} <= set(c.get(f"{l12}/sync/ids").json()["ids"]))
    before = c.get(f"{l34}/rejected").json()["total"]
    db = sqlite3.connect(demo["run"] / "hub-L34.db")  # the Directorate deletes the newest row
    db.execute("DELETE FROM events WHERE id = ?", (sent[-1]["id"],))
    db.commit()
    db.close()
    assert wait_for(lambda: sent[-1]["id"] in c.get(f"{l34}/sync/ids").json()["ids"])
    time.sleep(3)  # several more sync ticks
    assert c.get(f"{l34}/rejected").json()["total"] == before
    assert c.get(f"{l34}/events/verify").json()["chain_intact"]
    assert c.get(f"{l34}/sync/status").json()["restored"] == 1


def test_reset_wipes_both_and_keeps_the_signing_setup(demo):
    c, (l34, l12) = demo["client"], demo["urls"]
    assert c.post(f"{l34}/events", json=alert("hub-L34", demo["box"])).status_code == 201
    assert demo_hubs.main(["reset", *demo["base"]]) == 0
    for url in (l34, l12):
        assert c.get(f"{url}/health").json()["events"] == 0
        assert c.get(f"{url}/roster").json()["require_signed"] is True
    time.sleep(2)
    assert c.get(f"{l34}/rejected").json()["total"] == 0  # no stale events bounced back


def test_down_stops_both(demo):
    assert demo_hubs.main(["down", *demo["base"]]) == 0
    for url in demo["urls"]:
        with pytest.raises(httpx.HTTPError):
            httpx.get(f"{url}/health", timeout=1)
