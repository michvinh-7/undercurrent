from datetime import datetime, timedelta, timezone
import uuid

import pytest

from app import crypto
from app.gate import Gate, Rejected
from app.log import EventLog
from app.models import EventIn
from app.roster import Roster

HUB = "hub-L34"
NOW = datetime(2087, 3, 14, 2, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


@pytest.fixture
def keys():
    return {"op": crypto.new_key(), "member": crypto.new_key(), "outsider": crypto.new_key()}


@pytest.fixture
def gate(tmp_path, keys):
    roster = Roster([
        {"pub": crypto.public_key(keys["op"]), "role": "operator"},
        {"pub": crypto.public_key(keys["member"]), "role": "member"},
    ])
    return Gate(EventLog(str(tmp_path / "t.db"), HUB), roster, HUB, require_signed=True, window_s=300)


def signed(key, at=NOW, **over):
    fields = {
        "id": str(uuid.uuid4()), "type": "hazard", "hub_id": HUB, "level": 34,
        "created_at": at.isoformat().replace("+00:00", "Z"), "author": "canary-34",
        "payload": {"kind": "flooding", "severity": "high"}, "source": "sensor", "device_id": "canary-34",
        **over,
    }
    return EventIn(**crypto.sign(fields, key))


def test_valid_signed_event_is_stored_with_signer_fields(gate, keys):
    e = signed(keys["member"])
    stored = gate.admit(e, now=NOW)
    assert (stored.id, stored.created_at, stored.hub_id) == (e.id, e.created_at, e.hub_id)
    assert stored.sig == e.sig and stored.source == "sensor"
    assert gate.log.verify() == (True, None)


@pytest.mark.parametrize("field,value", [
    ("level", 12), ("payload", {"kind": "flooding", "severity": "low"}), ("source", "resident"),
    ("created_at", "2087-03-14T02:00:01Z"), ("hub_id", "hub-L12"),
])
def test_changing_any_signed_field_breaks_the_signature(gate, keys, field, value):
    e = signed(keys["member"]).model_copy(update={field: value})
    with pytest.raises(Rejected, match="bad signature"):
        gate.admit(e, now=NOW)


def test_unknown_key_is_rejected_and_recorded(gate, keys):
    with pytest.raises(Rejected, match="unknown key"):
        gate.admit(signed(keys["outsider"], payload={"kind": "flooding", "severity": "low", "note": "all clear"}), now=NOW)
    total, items = gate.log.rejected()
    assert total == 1 and items[0]["reason"] == "unknown key" and items[0]["via"] == "post"
    assert gate.log.count() == 0


def test_replayed_event_is_rejected(gate, keys):
    e = signed(keys["member"])
    gate.admit(e, now=NOW)
    with pytest.raises(Rejected, match="duplicate id"):
        gate.admit(e, now=NOW)
    with pytest.raises(Rejected, match="duplicate id"):
        gate.admit(e, fresh=False)
    assert gate.log.count() == 1


def test_stale_event_rejected_when_fresh_but_accepted_by_sync(gate, keys):
    old = signed(keys["member"], at=NOW - timedelta(hours=2))
    with pytest.raises(Rejected, match="time window"):
        gate.admit(old, fresh=True, now=NOW)
    assert gate.admit(old, fresh=False).id == old.id  # queued during a cut, arrives late


def test_event_for_another_hub_rejected_when_fresh(gate, keys):
    with pytest.raises(Rejected, match="not this hub"):
        gate.admit(signed(keys["member"], hub_id="hub-L12"), now=NOW)


def test_unsigned_rejected_only_when_required(gate, keys, tmp_path):
    e = EventIn(type="checkin", level=31, author="anon-1", payload={"status": "ok"})
    with pytest.raises(Rejected, match="unsigned"):
        gate.admit(e, now=NOW)
    open_gate = Gate(EventLog(str(tmp_path / "open.db"), HUB), Roster(), HUB, require_signed=False)
    stored = open_gate.admit(e)
    assert stored.hub_id == HUB and stored.id and stored.sig is None


def test_rescoring_priority_keeps_signature_and_hash(gate, keys):
    e = signed(keys["member"])
    rescored = e.model_copy(update={"priority": 0.9})
    assert crypto.verify(rescored.model_dump())
    stored = gate.admit(rescored, now=NOW)
    assert stored.priority == 0.9 and gate.log.verify() == (True, None)


def test_non_ascii_text_signs_and_verifies(keys):
    e = signed(keys["member"], payload={"kind": "flooding", "severity": "high", "note": "Água no nível 34 — já"})
    assert "Água".encode() in crypto.canonical_bytes(e.model_dump())
    assert crypto.verify(e.model_dump())


def test_roster_add_by_operator_then_member_can_post(gate, keys):
    newbie = crypto.new_key()
    add = signed(keys["op"], type="roster", author="op-1", source=None, device_id=None,
                 payload={"action": "add", "pub": crypto.public_key(newbie), "role": "member"})
    gate.admit(add, now=NOW)
    assert gate.admit(signed(newbie), now=NOW)
    # the roster comes back from the log when the hub restarts
    restarted = Gate(gate.log, Roster([{"pub": crypto.public_key(keys["op"]), "role": "operator"}]), HUB,
                     require_signed=True)
    assert restarted.roster.is_member(crypto.public_key(newbie))


def test_roster_change_by_member_is_rejected(gate, keys):
    add = signed(keys["member"], type="roster", author="m", source=None, device_id=None,
                 payload={"action": "add", "pub": crypto.public_key(crypto.new_key())})
    with pytest.raises(Rejected, match="not an operator"):
        gate.admit(add, now=NOW)


def test_old_unsigned_events_hash_as_before(tmp_path):
    """Events stored before signing existed must still verify after the upgrade."""
    import hashlib, json
    from app.log import compute_hash
    fields = {"id": "x", "type": "checkin", "hub_id": HUB, "level": 1, "created_at": "2087-01-01T00:00:00Z",
              "author": "a", "payload": {"status": "ok"}, "priority": None, "author_pub": None, "sig": None,
              "source": None, "device_id": None}
    old = {k: fields[k] for k in ("id", "type", "hub_id", "level", "created_at", "author", "payload")}
    expected = hashlib.sha256((json.dumps(old, sort_keys=True, separators=(",", ":")) + "p").encode()).hexdigest()
    assert compute_hash(fields, "p") == expected
