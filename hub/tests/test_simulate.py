"""sim/simulate.py against two real demo hubs on free ports (a few seconds each).

Covers: every simulated event arrives signed and verified on both hubs, the unsigned
fallback when the hubs allow it, refusing to start when signing is required and the sim's
keys aren't on the roster, and the world.json checks.
"""

import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sim"))
sys.path.insert(0, str(ROOT / "hub" / "scripts"))

import demo_hubs  # noqa: E402
import roster_tool  # noqa: E402
import simulate  # noqa: E402
from test_demo_scripts import free_ports, wait_for  # noqa: E402

WORLD = json.loads((ROOT / "sim" / "world.json").read_text())


def tiny_world(tmp_path, steps=None):
    """world.json with a short timeline (times in nominal seconds; tests run them fast)."""
    w = json.loads(json.dumps(WORLD))
    if steps is not None:
        w["timeline"] = steps
    p = tmp_path / "world.json"
    p.write_text(json.dumps(w))
    return p, w


def sim(*argv, world, keys):
    return simulate.main(["--world", str(world), "--keys", str(keys), *argv])


@pytest.fixture
def hubs(tmp_path, request):
    signed = getattr(request, "param", True)
    world, _ = tiny_world(tmp_path)
    keys = tmp_path / "keys"
    op = tmp_path / "op.key"
    roster_tool.main(["new-key", "--out", str(op)])
    assert sim("keys", world=world, keys=keys) == 0
    roster = tmp_path / "roster.json"
    if signed:
        assert sim("roster", "--operator", str(op), "--out", str(roster), world=world, keys=keys) == 0
    else:
        roster_tool.main(["file", "--operator", str(op), "--out", str(roster)])  # sim keys left off
    ports = free_ports(2)
    base = ["--ports", *map(str, ports), "--dir", str(tmp_path / "run")]
    up = ["up", "--roster", str(roster), *base] + (["--signed"] if signed else [])
    assert demo_hubs.main(up) == 0
    yield {"tmp": tmp_path, "keys": keys, "run": tmp_path / "run", "urls": [f"http://127.0.0.1:{p}" for p in ports]}
    demo_hubs.main(["down", *base])


def test_world_json_is_valid_and_never_simulates_the_real_box():
    simulate.check_world(WORLD)
    assert "canary-34" not in simulate.actors(WORLD)
    assert simulate.hub_for(WORLD, 35) == "hub-L34" and simulate.hub_for(WORLD, 12) == "hub-L12"
    bad = json.loads(json.dumps(WORLD))
    bad["canaries"].append({"device_id": "canary-34", "level": 34, "at": "pump"})
    with pytest.raises(SystemExit, match="real box"):
        simulate.check_world(bad)
    bad = json.loads(json.dumps(WORLD))
    bad["timeline"][0]["payload"]["reading"]["value"] = 3.5
    with pytest.raises(SystemExit, match="floats"):
        simulate.check_world(bad)
    bad = json.loads(json.dumps(WORLD))
    bad["timeline"][0]["by"] = "nobody"
    with pytest.raises(SystemExit, match="unknown sender"):
        simulate.check_world(bad)


def test_keys_are_kept_between_runs_and_roster_lists_them(tmp_path):
    world, w = tiny_world(tmp_path)
    keys = tmp_path / "keys"
    assert sim("keys", world=world, keys=keys) == 0
    first = {p.name: p.read_text() for p in keys.iterdir()}
    assert len(first) == len(simulate.actors(w))
    assert sim("keys", world=world, keys=keys) == 0
    assert {p.name: p.read_text() for p in keys.iterdir()} == first
    op = tmp_path / "op.key"
    roster_tool.main(["new-key", "--out", str(op)])
    out = tmp_path / "roster.json"
    phone = roster_tool.crypto.public_key(roster_tool.crypto.new_key())
    assert sim("roster", "--operator", str(op), "--member", f"{phone}:phone-1", "--out", str(out), world=world, keys=keys) == 0
    entries = json.loads(out.read_text())
    assert [e["role"] for e in entries].count("operator") == 1
    assert {e.get("name") for e in entries} >= set(simulate.actors(w)) | {"phone-1"}


def test_full_run_arrives_signed_and_verified_on_both_hubs(hubs):
    world = ROOT / "sim" / "world.json"
    truth = hubs["tmp"] / "truth"
    argv = ["run", "--minutes", "0.05", "--dir", str(hubs["run"]), "--truth-dir", str(truth)]
    assert sim(*argv, world=world, keys=hubs["keys"]) == 0
    n = len(WORLD["timeline"])
    c = httpx.Client(timeout=5)
    l34, l12 = hubs["urls"]
    assert wait_for(lambda: all(c.get(f"{u}/health").json()["events"] == n for u in (l34, l12)))
    members = {m["pub"] for m in c.get(f"{l12}/roster").json()["members"]}
    events = c.get(f"{l12}/events").json()
    assert all(e["sig"] and e["author_pub"] in members for e in events)
    assert {e["hub_id"] for e in events if e["level"] in (34, 35)} == {"hub-L34"}
    assert {e["hub_id"] for e in events if e["level"] == 12} == {"hub-L12"}
    assert all(e["payload"].get("simulated") is True for e in events)  # labelled, inside the signature
    surface = [e for e in events if e.get("device_id") == "canary-surface"]
    assert len(surface) == 3 and all(e["level"] == 1 and e["hub_id"] == "hub-L12" and e["author_pub"] in members for e in surface)
    assert all(isinstance(e["payload"]["oxygen_pct"], int) for e in surface)
    sensors = [e for e in events if e.get("device_id")]
    assert sensors and all(e["source"] == "sensor" and e["author"] == e["device_id"] for e in sensors)
    assert c.get(f"{l34}/rejected").json()["total"] == 0
    assert all(c.get(f"{u}/events/verify").json()["chain_intact"] for u in (l34, l12))
    t = json.loads((truth / "truth.json").read_text())
    assert t["reported_cases"]["34"]["water"] == 5 and t["reported_cases"]["34"]["lungs"] == 6
    assert t["true_cases"]["34"]["water"] > t["reported_cases"]["34"]["water"]
    assert json.loads((truth / "directorate.json").read_text())["lung_cases"]["34"] == 0


@pytest.mark.parametrize("hubs", [False], indirect=True)
def test_unsigned_fallback_when_keys_arent_on_the_roster(hubs):
    world, _ = tiny_world(hubs["tmp"], WORLD["timeline"][:3])
    argv = ["run", "--minutes", "0.05", "--dir", str(hubs["run"]), "--truth-dir", str(hubs["tmp"] / "t")]
    assert sim(*argv, world=world, keys=hubs["keys"]) == 0
    events = httpx.get(f"{hubs['urls'][0]}/events").json()
    assert len(events) == 3 and not any(e["sig"] for e in events)


def test_refuses_to_start_when_signing_is_required_and_keys_are_missing(hubs):
    world, _ = tiny_world(hubs["tmp"], WORLD["timeline"][:3])
    fresh_keys = hubs["tmp"] / "other-keys"
    sim("keys", world=world, keys=fresh_keys)  # keys the hubs have never heard of
    argv = ["run", "--minutes", "0.05", "--dir", str(hubs["run"]), "--truth-dir", str(hubs["tmp"] / "t")]
    with pytest.raises(SystemExit, match="requires signing"):
        sim(*argv, world=world, keys=fresh_keys)
    assert httpx.get(f"{hubs['urls'][0]}/health").json()["events"] == 0
