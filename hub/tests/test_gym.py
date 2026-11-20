"""eval/run_directorate_gym.py: resets are exact, and the oracle scores each kind of attack
the way the published threat model says (no model needed; the fuzzer is plain code)."""

import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "eval"))

import run_directorate_gym as gym  # noqa: E402


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


@pytest.fixture(scope="module")
def golden(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    mp.setenv("TRIAGE_ON_INGEST", "0")
    yield gym.build_golden(tmp_path_factory.mktemp("gym"))
    mp.undo()


@pytest.fixture
def ep(golden, tmp_path):
    e = gym.Episode(golden, tmp_path / "ep.db", random.Random(1))
    yield e
    e.close()


def ids(golden, hub):
    return [e["id"][:8] for e in golden["golden_events"] if e["hub_id"] == hub]


def test_reset_is_identical_and_leaves_the_golden_file_alone(golden, tmp_path):
    before = gym.sha256_file(golden["path"])
    a = gym.Episode(golden, tmp_path / "a.db", random.Random(1))
    a.step({"action": "db_delete", "event": ids(golden, gym.HUB)[3]})
    b = gym.Episode(golden, tmp_path / "b.db", random.Random(2))
    assert a.reset_identical and b.reset_identical
    assert len(b.gate.log.list()) == len(golden["golden_ids"])  # a's delete never reached b
    assert gym.sha256_file(golden["path"]) == before
    a.close(), b.close()


def test_forgeries_are_refused_and_nothing_is_breached(ep):
    assert ep.step({"action": "forge", "fields": {"payload": {"kind": "all_clear"}}})[1] == "unknown key"
    assert ep.step({"action": "forge", "fields": {}, "claim_pub": "canary-34"})[1] == "bad signature"
    assert ep.step({"action": "roster_grab", "role": "operator"})[1] == "roster: signer is not an operator"
    assert ep.step({"action": "unsigned", "fields": {}})[1] == "unsigned"
    v = ep.verdict()
    assert v["breaches"] == [] and not v["tampered"]


def test_delivering_a_real_intercepted_alert_is_not_a_breach(golden, ep):
    fresh = golden["intercepted"][0]["id"][:8]
    assert ep.step({"action": "reuse", "base": fresh, "changes": {}})[0] == "accepted"
    assert ep.step({"action": "reuse", "base": fresh, "changes": {"level": 33, "id": "x" * 36}})[0] == "refused"
    v = ep.verdict()
    assert v["breaches"] == [] and v["genuine_delivered"] == 1


def test_a_rehashed_edit_is_still_flagged_by_the_signature(golden, ep):
    out = ep.step({"action": "db_edit", "event": ids(golden, gym.HUB)[2], "changes": {"level": 33}, "rehash": "chain"})
    assert out[0] == "edited, flagged"
    v = ep.verdict()
    assert v["hub_flagged"] and v["verify_flagged"] and v["breaches"] == []


def test_deleting_the_peers_newest_row_is_unseen_alone_and_repaired_by_sync(golden, ep):
    """The gym found this: this hub can't tell a deleted row of ANOTHER hub's chain from one
    that hasn't arrived. The peer still holds it, and one sync round puts it back."""
    assert ep.step({"action": "db_delete", "event": ids(golden, gym.PEER)[-1]})[0] == "edited, NOT flagged"
    v = ep.verdict()
    assert v["blind_alone"] and v["repaired_by_sync"] and v["breaches"] == []


def test_fuzz_episodes_replay_identically_from_their_seed(golden, tmp_path):
    a = gym.fuzz_episode((golden, str(tmp_path), 42, 15))
    b = gym.fuzz_episode((golden, str(tmp_path), 42, 15))
    assert a["fingerprint"] == b["fingerprint"] and a["outcomes"] == b["outcomes"] and a["reset_identical"]
