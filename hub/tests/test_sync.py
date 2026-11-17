import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import crypto
from app.gate import Gate, Rejected
from app.link import Link
from app.log import EventLog
from app.models import EventIn
from app.roster import Roster
from app.sync import Syncer, make_router


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


class Memory:
    """In-memory transport: peers are Syncers in the same process. `down` = unreachable."""

    def __init__(self):
        self.hubs: dict[str, Syncer] = {}
        self.down: set[str] = set()

    def _hub(self, peer):
        if peer in self.down:
            raise ConnectionError(f"{peer} is down")
        return self.hubs[peer]

    def ids(self, peer):
        return set(self._hub(peer).log.ids())

    def push(self, peer, events):
        return self._hub(peer).receive(events)


OP, MEMBER = crypto.new_key(), crypto.new_key()


def roster():
    return Roster([
        {"pub": crypto.public_key(OP), "role": "operator"},
        {"pub": crypto.public_key(MEMBER), "role": "member"},
    ])


def make_hub(tmp_path, net, hub_id, peer_id, require_signed=True):
    log = EventLog(str(tmp_path / f"{hub_id}.db"), hub_id)
    gate = Gate(log, roster(), hub_id, require_signed=require_signed)
    s = Syncer(log, gate, Link(), [peer_id], net)
    net.hubs[hub_id] = s
    return s


@pytest.fixture
def pair(tmp_path):
    net = Memory()
    return make_hub(tmp_path, net, "hub-L34", "hub-L12"), make_hub(tmp_path, net, "hub-L12", "hub-L34"), net


def post(hub, key=MEMBER, **over):
    fields = {
        "id": str(uuid.uuid4()), "type": "hazard", "hub_id": hub.log.hub_id, "level": 34,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "author": "canary-34", "payload": {"kind": "flooding", "severity": "high"}, "source": "sensor",
        **over,
    }
    return hub.gate.admit(EventIn(**crypto.sign(fields, key)))


def settle(*hubs, rounds=5):
    for _ in range(rounds):
        for h in hubs:
            h.tick()


def ids(hub):
    return set(hub.log.ids())


# ---------------------------------------------------------------- log: one chain per origin hub

def test_synced_events_keep_their_origin_chain(pair):
    a, b, _ = pair
    a1, a2 = post(a), post(a)
    b1 = post(b, level=12)
    settle(a, b)
    assert ids(a) == ids(b) == {a1.id, a2.id, b1.id}
    # B's next local event chains after B's own last event, not after A's
    b2 = post(b, level=12)
    assert b2.prev_hash == b1.hash
    assert a.log.verify_report() == b.log.verify_report() == {"chain_intact": True, "first_bad_event": None, "gaps": {}}


def test_out_of_order_arrival_is_a_gap_not_tampering(pair):
    a, b, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    b.receive([a3])  # arrives first (higher priority on the link)
    assert b.log.verify_report() == {"chain_intact": True, "first_bad_event": None, "gaps": {"hub-L34": 1}}
    b.receive([a1, a2])
    assert b.log.verify_report()["gaps"] == {}


def test_tampered_synced_row_is_caught(pair):
    a, b, _ = pair
    a1 = post(a)
    settle(a, b)
    b.log._db.execute("UPDATE events SET payload = ? WHERE id = ?", (json.dumps({"kind": "flooding", "severity": "low"}), a1.id))
    b.log._db.commit()
    assert b.log.verify() == (False, a1.id)


def test_deleting_a_row_of_our_own_chain_is_caught(pair):
    a, _, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    a.log._db.execute("DELETE FROM events WHERE id = ?", (a2.id,))
    a.log._db.commit()
    assert a.log.verify() == (False, a3.id)


def test_edit_with_recomputed_hash_is_caught_by_the_signature(pair):
    from app.log import compute_hash
    a, _, _ = pair
    a1 = post(a)
    forged = {**a1.model_dump(), "level": 12}
    a.log._db.execute("UPDATE events SET level = 12, hash = ? WHERE id = ?", (compute_hash(forged, a1.prev_hash), a1.id))
    a.log._db.commit()
    assert a.log.verify() == (False, a1.id)


# ---------------------------------------------------------------- sync: cuts, duplicates, forgeries

def test_cut_holds_events_and_restore_delivers_all(pair):
    a, b, _ = pair
    a.link_control(lambda l: l.cut())
    sent = {post(a).id for _ in range(5)}
    settle(a, b)
    assert not sent & ids(b)  # nothing crossed the cut
    a.link_control(lambda l: l.restore())
    settle(a, b)
    assert sent <= ids(b) and a.in_flight == set()


def test_events_finished_before_a_cut_are_delivered_not_dropped(pair):
    a, b, _ = pair
    e = post(a)
    a.link.enqueue(e)  # crossed the link, but not yet pushed when the cut lands
    a.in_flight.add(e.id)
    a.link_control(lambda l: l.cut())
    assert e.id in ids(b) and a.in_flight == set()


def test_peer_down_then_back_loses_nothing(pair):
    a, b, net = pair
    net.down.add("hub-L12")
    sent = {post(a).id for _ in range(3)}
    settle(a)
    assert a.in_flight == set()  # failed pushes leave in_flight, so they're queued again later
    net.down.clear()
    settle(a, b)
    assert sent <= ids(b)


def test_same_event_twice_is_stored_once_and_not_a_forgery(pair):
    a, b, _ = pair
    e = post(a)
    assert b.receive([e, e]) == {"stored": 1, "duplicate": 1, "deferred": 0, "rejected": 0}
    assert b.log.count() == 1 and b.log.rejected()[0] == 0


def test_same_id_different_content_is_rejected(pair):
    a, b, _ = pair
    e = post(a)
    b.receive([e])
    other = e.model_copy(update={"hash": "f" * 64})
    with pytest.raises(Rejected, match="conflict"):
        b.gate.admit_synced(other)


def test_forged_event_over_sync_is_rejected_and_counted(pair):
    a, b, _ = pair
    outsider = crypto.new_key()
    e = post(a)
    forged_fields = crypto.sign({**e.model_dump(), "id": str(uuid.uuid4()),
                                 "payload": {"kind": "flooding", "severity": "low", "note": "all clear"}}, outsider)
    from app.log import compute_hash
    from app.models import Event
    forged = Event(**forged_fields)
    forged = forged.model_copy(update={"hash": compute_hash(forged.model_dump(), forged.prev_hash)})
    # An unknown key over sync is deferred (its roster event may be in transit), never stored
    assert b.receive([forged]) == {"stored": 0, "duplicate": 0, "deferred": 1, "rejected": 0}
    tampered = e.model_copy(update={"level": 12})
    tampered = tampered.model_copy(update={"hash": compute_hash(tampered.model_dump(), tampered.prev_hash)})
    assert b.receive([tampered])["rejected"] == 1
    total, items = b.log.rejected()
    assert total == 1 and items[0]["reason"] == "bad signature" and items[0]["via"] == "sync"


def test_new_member_deferred_until_their_roster_event_arrives(pair):
    a, b, _ = pair
    newbie = crypto.new_key()
    add = post(a, key=OP, type="roster", author="op", source=None,
               payload={"action": "add", "pub": crypto.public_key(newbie), "role": "member"})
    e = post(a, key=newbie)
    assert b.receive([e])["deferred"] == 1
    b.receive([add])
    assert b.receive([e])["stored"] == 1


def test_random_cuts_lose_and_duplicate_nothing(pair):
    import random
    a, b, _ = pair
    rng = random.Random(7)
    sent = set()
    for step in range(60):
        hub = rng.choice((a, b))
        sent.add(post(hub, level=34 if hub is a else 12).id)
        if rng.random() < 0.3:
            h = rng.choice((a, b))
            h.link_control(lambda l: l.cut() if not l.is_cut else l.restore())
        rng.choice((a, b)).tick()
    for h in (a, b):
        h.link_control(lambda l: l.restore())
    settle(a, b)
    assert ids(a) == ids(b) == sent
    assert a.log.count() == b.log.count() == len(sent)
    for h in (a, b):
        assert h.log.verify_report() == {"chain_intact": True, "first_bad_event": None, "gaps": {}}
        assert h.log.rejected()[0] == 0


# ---------------------------------------------------------------- routes

def test_sync_routes(pair):
    a, b, _ = pair
    app = FastAPI()
    app.include_router(make_router(b))
    client = TestClient(app)
    e = post(a)
    r = client.post("/sync/events", json=[e.model_dump(mode="json")])
    assert r.status_code == 200 and r.json()["stored"] == 1
    assert client.get("/sync/ids").json() == {"hub_id": "hub-L12", "ids": [e.id]}
    assert client.get("/sync/status").json()["in_flight"] == 0


def test_synced_event_claiming_to_be_from_this_hub_is_rejected(pair):
    a, b, _ = pair
    e = post(b, level=12)  # a real event of B's
    b.log._db.execute("DELETE FROM events")  # pretend B never stored it
    b.log._db.commit()
    with pytest.raises(Rejected, match="this hub"):
        b.gate.admit_synced(e)
    assert b.receive([post(a)])["stored"] == 1  # other hubs' events still go through


def test_cut_link_shows_the_backlog_and_drains_on_restore(pair):
    a, b, _ = pair
    post(a)
    settle(a, b)  # A now knows which ids B holds
    a.link_control(lambda l: l.cut())
    held = {post(a).id for _ in range(3)}
    a.tick()
    assert a.link.status()["queued"] == 3  # the dashboard's "waiting to send"
    assert not held & ids(b)
    a.link_control(lambda l: l.restore())
    settle(a, b)
    assert held <= ids(b) and a.link.status()["queued"] == 0
