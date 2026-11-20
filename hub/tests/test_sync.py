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
from app.sync import NotSupported, Syncer, make_router, missing


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


@pytest.fixture(autouse=True, params=["summary", "ids"])
def sync_mode(request, monkeypatch):
    """Every sync test runs twice: peers asked for a summary, and peers on older code (ids)."""
    monkeypatch.setattr(Memory, "ids_only", request.param == "ids")
    return request.param


class Memory:
    """In-memory transport: peers are Syncers in the same process. `down` = unreachable.
    Asked for a summary like a current hub; with ids_only, answers like a hub on older code."""

    ids_only = False

    def __init__(self):
        self.hubs: dict[str, Syncer] = {}
        self.down: set[str] = set()

    def summary(self, peer, mine=None):
        if self.ids_only:
            raise NotSupported(peer)
        log = self._hub(peer).log
        fp = log.fingerprint()
        return (None if mine == fp else log.summary()), fp

    def _hub(self, peer):
        if peer in self.down:
            raise ConnectionError(f"{peer} is down")
        return self.hubs[peer]

    def ids(self, peer):
        log = self._hub(peer).log
        return set(log.ids()), log.fingerprint()

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
    assert b.receive([e, e]) == {"stored": 1, "restored": 0, "duplicate": 1, "deferred": 0, "rejected": 0, "refused": []}
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
    assert b.receive([forged]) == {"stored": 0, "restored": 0, "duplicate": 0, "deferred": 1, "rejected": 0, "refused": []}
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
    assert client.get("/sync/ids").json() == {"hub_id": "hub-L12", "ids": [e.id], "fingerprint": b.log.fingerprint()}
    assert client.get("/sync/status").json()["in_flight"] == 0


def test_synced_event_claiming_to_be_from_this_hub_is_rejected(pair):
    a, b, _ = pair
    e = post(b, level=12)  # a real event of B's
    b.log._db.execute("DELETE FROM events")  # pretend B never stored it, and has
    b.log._db.execute("DELETE FROM own_hashes")  # no record of writing it either
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


# ---------------------------------------------------------------- a hub gets its own deleted rows back

def delete_row(hub, event_id):
    hub.log._db.execute("DELETE FROM events WHERE id = ?", (event_id,))
    hub.log._db.commit()


def rejected_total(hub):
    return hub.log.rejected()[0]


def test_deleted_newest_row_comes_back_from_the_peer(pair):
    a, b, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    settle(a, b)
    delete_row(a, a3.id)  # the Directorate deletes A's newest row
    settle(a, b)
    assert a3.id in ids(a)
    assert a.log.verify_report() == {"chain_intact": True, "first_bad_event": None, "gaps": {}}
    assert rejected_total(a) == 0  # a row coming home is not a forgery
    assert a.status()["restored"] == 1 and b.status()["restored"] == 0  # B sent it; A counts it


def test_deleted_middle_row_comes_back_and_the_chain_continues(pair):
    a, b, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    settle(a, b)
    delete_row(a, a2.id)
    assert a.log.verify() == (False, a3.id)  # caught while it's missing
    settle(a, b)
    assert a.log.verify_report()["chain_intact"]
    a4 = post(a)  # the next event chains after a3, the real tip, not after the restored a2
    assert a4.prev_hash == a3.hash
    settle(a, b)
    assert a.log.verify_report()["chain_intact"] and b.log.verify_report()["chain_intact"]


def test_new_event_after_newest_row_deleted_still_chains_to_it(pair):
    a, b, _ = pair
    a1, a2 = post(a), post(a)
    settle(a, b)
    delete_row(a, a2.id)
    a3 = post(a)  # posted before sync brings a2 back
    assert a3.prev_hash == a2.hash  # the hub remembers its own tip
    assert a.log.verify() == (False, a3.id)  # and the deletion now shows
    settle(a, b)
    assert a.log.verify_report()["chain_intact"] and a2.id in ids(a)


def test_wiped_hub_refuses_its_old_events_once_not_every_tick(tmp_path):
    net = Memory()
    a = make_hub(tmp_path, net, "hub-L34", "hub-L12")
    b = make_hub(tmp_path, net, "hub-L12", "hub-L34")
    old = [post(a) for _ in range(3)]
    settle(a, b)
    # A's database is wiped (a rehearsal reset of one hub only); B keeps its copy
    a.log._db.close()
    (tmp_path / "hub-L34.db").unlink()
    a = make_hub(tmp_path, net, "hub-L34", "hub-L12")
    b.peer_view.clear()
    settle(a, b, rounds=10)
    assert not {e.id for e in old} & ids(a)  # A can't prove it wrote them: not taken back
    assert rejected_total(a) == 3  # each counted once, not once per tick
    assert b.refused["hub-L34"] == {e.id for e in old}  # and B stops sending them
    assert b.link.status()["queued"] == 0
    fresh = post(a)
    settle(a, b)
    assert fresh.id in ids(b)


def test_restored_row_must_match_what_this_hub_wrote(pair):
    a, b, _ = pair
    a1 = post(a)
    settle(a, b)
    delete_row(a, a1.id)
    from app.log import compute_hash
    altered = a1.model_copy(update={"payload": {"kind": "flooding", "severity": "low"}})
    altered = altered.model_copy(update={"hash": compute_hash(altered.model_dump(), altered.prev_hash)})
    with pytest.raises(Rejected):
        a.gate.admit_synced(altered)
    assert a1.id not in ids(a)


def test_member_cannot_slip_an_event_into_this_hubs_chain_over_sync(pair):
    a, b, _ = pair
    a1 = post(a)
    from app.log import compute_hash
    from app.models import Event
    fields = crypto.sign({"id": str(uuid.uuid4()), "type": "hazard", "hub_id": "hub-L34", "level": 34,
                          "created_at": "2020-01-01T00:00:00Z", "author": "x",
                          "payload": {"kind": "flooding", "severity": "low"}}, MEMBER)
    e = Event(**fields, prev_hash=a1.hash, hash="0")
    e = e.model_copy(update={"hash": compute_hash(e.model_dump(), e.prev_hash)})
    with pytest.raises(Rejected, match="this hub"):
        a.gate.admit_synced(e)  # fits A's tip and is validly signed, but A never wrote it
    assert e.id not in ids(a)


def test_own_hashes_backfilled_for_an_existing_database(tmp_path):
    net = Memory()
    a = make_hub(tmp_path, net, "hub-L34", "hub-L12")
    a1, a2 = post(a), post(a)
    a.log._db.execute("DROP TABLE own_hashes")  # a hub.db from before this change
    a.log._db.commit()
    a.log._db.close()
    a = make_hub(tmp_path, net, "hub-L34", "hub-L12")
    a3 = post(a)
    assert a3.prev_hash == a2.hash
    delete_row(a, a1.id)
    assert a.gate.admit_synced(a1) == "restored"


def test_roster_event_from_a_new_operator_waits_for_the_promotion(pair):
    a, b, _ = pair
    op2, newbie = crypto.new_key(), crypto.new_key()
    promote = post(a, key=OP, type="roster", author="op", source=None,
                   payload={"action": "add", "pub": crypto.public_key(op2), "role": "operator"})
    add = post(a, key=op2, type="roster", author="op2", source=None,
               payload={"action": "add", "pub": crypto.public_key(newbie), "role": "member"})
    assert b.receive([add])["deferred"] == 1  # op2 isn't an operator on B yet: wait, don't refuse
    assert b.log.rejected()[0] == 0
    settle(a, b)
    assert {promote.id, add.id} <= ids(b) and b.gate.roster.is_member(crypto.public_key(newbie))


# ---------------------------------------------------------------- "hubs agree" fingerprint

def test_fingerprint_matches_once_synced_whatever_the_order(pair):
    a, b, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    b1 = post(b, level=12)
    b.receive([a3, a1])  # B gets A's events out of order
    assert a.log.fingerprint() != b.log.fingerprint()
    settle(a, b)
    assert a.log.fingerprint() == b.log.fingerprint()
    assert a.status()["agrees_with"] == {"hub-L12": True} and b.status()["agrees_with"] == {"hub-L34": True}


def test_fingerprint_differs_while_an_event_is_held_back_and_matches_after(pair):
    a, b, _ = pair
    post(a)
    settle(a, b)
    a.link_control(lambda l: l.cut())
    post(a)
    a.tick()
    b.tick()
    assert a.log.fingerprint() != b.log.fingerprint()
    assert a.status()["agrees_with"] == {"hub-L12": None}  # nothing crosses a cut link, not even this
    a.link_control(lambda l: l.restore())
    settle(a, b)
    assert a.log.fingerprint() == b.log.fingerprint() and a.status()["agrees_with"] == {"hub-L12": True}


def test_fingerprint_is_short_and_changes_with_any_event(pair):
    a, _, _ = pair
    empty = a.log.fingerprint()
    post(a)
    assert len(empty) == 12 and a.log.fingerprint() != empty


def test_peer_on_older_code_without_a_fingerprint_is_unknown(pair):
    a, b, net = pair
    post(a)
    old_ids = net.ids
    net.ids = lambda peer: old_ids(peer)[0]  # ids only, no fingerprint: what an old hub sends
    net.ids_only = True  # and no summary either
    settle(a, b)
    assert a.status()["agrees_with"] == {"hub-L12": None}
    assert a.last_error == {} and ids(a) == ids(b)  # and sync with it still works


# ---------------------------------------------------------------- the summary: bytes per hub, not per event

def test_summary_is_per_origin_and_stops_at_a_gap(pair):
    a, b, _ = pair
    a1, a2, a3 = post(a), post(a), post(a)
    b.receive([a1, a3])  # a2 still in transit
    s = b.log.summary()
    assert s["hub-L34"] == {"n": 1, "head": a1.hash[:16], "first": a1.hash[:16]}
    assert [e.id for e in missing(a.log.list(), ("summary", s))] == [a2.id, a3.id]  # a3 offered again: B says duplicate
    b.receive([a2])
    assert b.log.summary()["hub-L34"] == {"n": 3, "head": a3.hash[:16], "first": a1.hash[:16]}
    assert missing(a.log.list(), ("summary", b.log.summary())) == []


def test_a_peer_whose_chain_differs_is_offered_the_whole_chain(pair):
    a, b, _ = pair
    evs = [post(a) for _ in range(3)]
    fake = {"hub-L34": {"n": 2, "head": "f" * 64, "first": "f" * 64}}  # different events
    assert {e.id for e in missing(a.log.list(), ("summary", fake))} == {e.id for e in evs}


def test_the_question_stays_small_as_the_log_grows(pair, sync_mode):
    import json
    a, b, _ = pair
    for _ in range(200):
        post(a)
    settle(a, b)
    summary = len(json.dumps(b.log.summary()))
    ids = len(json.dumps(b.log.ids()))
    assert summary < 100 and ids > 7000  # one origin: ~70 bytes, vs 200 ids at ~39 bytes each


def test_a_hub_on_older_code_is_asked_for_ids(pair, sync_mode):
    a, b, net = pair
    post(a)
    settle(a, b)
    assert ("hub-L12" in a.ids_only) == (sync_mode == "ids")
    assert a.peer_view["hub-L12"][0] == sync_mode


def test_a_chain_restarted_by_a_wiped_hub_is_offered_once_not_every_round(pair):
    a, b, _ = pair
    old = [post(a) for _ in range(3)]
    view = ("summary", {"hub-L34": {"n": 3, "head": old[-1].hash[:16], "first": old[0].hash[:16]}})
    a.log._db.execute("DELETE FROM events")
    a.log._db.commit()
    fresh = post(a)  # a new chain from the start: B's summary is longer, but it's not this chain
    assert [e.id for e in missing(a.log.list(), view)] == [fresh.id]
    assert missing(a.log.list(), view, delivered={fresh.id}) == []


def test_a_peer_holding_the_same_events_just_says_so(pair, sync_mode):
    a, b, net = pair
    post(a)
    settle(a, b)
    a.tick()
    assert a.peer_view["hub-L12"] == (("ids", ids(b)) if sync_mode == "ids" else ("summary", b.log.summary()))
    post(a)
    a.tick()  # now they differ: a full summary, and the new event goes
    settle(a, b)
    assert ids(a) == ids(b)
