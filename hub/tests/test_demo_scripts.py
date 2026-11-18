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


# ---------------------------------------------------------------- directorate.py, live against real hubs

import directorate  # noqa: E402


def d(demo, *argv):
    return directorate.main([*argv, "--dir", str(demo["run"])])


def box_alerts(demo, n=2, hub_id="hub-L12", url=None):
    url = url or demo["urls"][1]
    sent = [alert(hub_id, demo["box"], level=12, note=f"n{i}") for i in range(n)]
    for e in sent:
        assert demo["client"].post(f"{url}/events", json=e).status_code == 201
    return sent


def counter(demo, url):
    return demo["client"].get(f"{url}/rejected").json()["total"]


def test_forge_replay_tamper_are_refused_and_each_moves_the_counter_once(demo, capsys):
    l12 = demo["urls"][1]
    box_alerts(demo)
    before = counter(demo, l12)
    assert d(demo, "forge") == 0
    assert "unknown key" in capsys.readouterr().out
    assert d(demo, "replay") == 0
    assert "duplicate id" in capsys.readouterr().out
    assert d(demo, "tamper") == 0
    assert "bad signature" in capsys.readouterr().out
    assert counter(demo, l12) == before + 3
    reasons = [r["reason"] for r in demo["client"].get(f"{l12}/rejected").json()["rejected"][:3]]
    assert reasons == ["bad signature", "replay: duplicate id", "unknown key"]


def test_replay_with_nothing_to_replay_says_so(demo):
    with pytest.raises(SystemExit, match="no signed alert"):
        d(demo, "replay")


def test_edit_is_named_at_the_exact_row(demo, capsys):
    l12 = demo["urls"][1]
    sent = box_alerts(demo, n=3)
    assert d(demo, "edit") == 0
    assert demo["client"].get(f"{l12}/events/verify").json()["first_bad_event"] == sent[-1]["id"]
    assert sent[-1]["id"][:8] in capsys.readouterr().out
    # a second edit, to an older record: the chain check reports the first bad record in order
    assert d(demo, "edit", "--id", sent[0]["id"]) == 0
    assert demo["client"].get(f"{l12}/events/verify").json()["first_bad_event"] == sent[0]["id"]


def test_delete_is_flagged_then_put_back_without_moving_the_counter(demo, capsys):
    l34, l12 = demo["urls"]
    sent = box_alerts(demo, n=3)
    assert wait_for(lambda: {e["id"] for e in sent} <= set(demo["client"].get(f"{l34}/sync/ids").json()["ids"]))
    before = counter(demo, l12)
    assert d(demo, "delete") == 0
    out = capsys.readouterr().out
    assert "names it as missing" in out and "put it back" in out
    assert counter(demo, l12) == before and demo["client"].get(f"{l12}/events/verify").json()["chain_intact"]


def test_cut_holds_alerts_restore_delivers_and_the_hubs_agree(demo, capsys):
    l34, l12 = demo["urls"]
    c = demo["client"]
    box_alerts(demo, n=1, hub_id="hub-L34", url=l34)
    assert wait_for(lambda: c.get(f"{l34}/sync/status").json()["agrees_with"] == {l12: True})
    assert d(demo, "cut") == 0
    held = box_alerts(demo, n=2, hub_id="hub-L34", url=l34)
    time.sleep(2)
    assert not {e["id"] for e in held} & set(c.get(f"{l12}/sync/ids").json()["ids"])
    assert c.get(f"{l34}/sync/status").json()["agrees_with"] == {l12: None}
    assert c.get(f"{l34}/health").json()["fingerprint"] != c.get(f"{l12}/health").json()["fingerprint"]
    assert d(demo, "restore") == 0
    assert wait_for(lambda: c.get(f"{l34}/sync/status").json()["agrees_with"] == {l12: True})
    assert c.get(f"{l34}/health").json()["fingerprint"] == c.get(f"{l12}/health").json()["fingerprint"]
    capsys.readouterr()
    assert d(demo, "status") == 0
    out = capsys.readouterr().out
    assert out.count("agrees") == 2


def test_revoke_demo_accepted_then_refused_on_both_hubs(demo, tmp_path, capsys):
    phone = tmp_path / "phone.key"
    roster_tool.main(["new-key", "--out", str(phone)])
    l34, l12 = demo["urls"]
    roster_tool.main(["add", str(phone), "--hub", l12, "--operator", str(demo["op"])])
    pub = json.loads(phone.read_text())["pub"]
    assert wait_for(lambda: any(m["pub"] == pub for m in demo["client"].get(f"{l34}/roster").json()["members"]))
    capsys.readouterr()
    assert d(demo, "revoke-demo", "--member", str(phone), "--operator", str(demo["op"])) == 0
    out = capsys.readouterr().out
    assert "MEMBER" in out and "stored" in out
    assert out.count("refused, unknown key") == 2


def test_revoke_demo_needs_the_phone_on_the_roster_first(demo, tmp_path):
    phone = tmp_path / "phone.key"
    roster_tool.main(["new-key", "--out", str(phone)])
    assert d(demo, "revoke-demo", "--member", str(phone), "--operator", str(demo["op"])) == 1


def test_no_demo_hubs_running_says_how_to_start_them(tmp_path):
    with pytest.raises(SystemExit, match="demo_hubs.py up"):
        directorate.main(["forge", "--dir", str(tmp_path / "nothing")])
