"""Hub-to-hub sync: no alert is lost or duplicated, whether the link is up, cut or coming back.

Merge = union by event id. Each tick, a hub asks every peer what it holds, queues the
events the peer is missing on its outbound link (hub/app/link.py), and pushes whatever has
finished crossing the link to its peers (POST /sync/events). The receiver runs every event
through Gate.admit_synced(): signature, roster, hash, and "do we already hold this exact event".

What a peer holds is asked as a summary (GET /sync/summary): per origin hub, how many events
of its chain the peer holds with no gap, and the hash of the last one. That's a few bytes per
hub however many events there are, where the full id list (GET /sync/ids, still answered, and
used for a peer on older code) grows with every event: about 38 bytes each, every round, to
every peer. The sender offers everything after the peer's gap-free prefix; if the peer's head
hash doesn't match the sender's chain at that point, it offers that origin's whole chain and
the receiver's gate decides. Events pass hop by hop: a hub offers its peers every event it
holds, whichever hub wrote it, so a line of hubs (one per level) carries an alert end to end.

Why nothing is lost:
- an event stays in `in_flight` from the moment it's queued until a push of it
  succeeds; a failed push (peer down) drops it from `in_flight`, so the next tick
  queues it again
- a cut holds queued events in the link (link.cut() re-queues the one mid-send),
  and the events that finished before the cut are pushed, not dropped (deliver())
Why nothing is duplicated: the receiver stores an id once; a repeat is "duplicate".
A row deleted from a hub's own chain comes back from a peer ("restored"), but only
if that hub wrote exactly that event (Gate.admit_synced). An event a peer refuses is
named in its reply ("refused") and not sent to that peer again, so it never takes
the slow link's bandwidth twice.

While the link is cut, the hub doesn't ask peers for their ids either: nothing
crosses a cut link. It still queues new events against the last id list each peer
sent, so the backlog shows in GET /link ("queued") and drains on restore. One outbound link
per hub, pushed to every peer (measured with 40 hubs in a line: eval/run_mesh.py).

Run it: set HUB_PEERS (comma-separated peer URLs) and the hub starts a sync loop
every SYNC_INTERVAL_S seconds (default 1).
"""

import threading
import time
from typing import Protocol

import httpx
from fastapi import APIRouter, HTTPException

from .gate import Gate, Rejected
from .link import Link
from .log import GENESIS, SHORT, EventLog, by_origin, chain_prefix
from .models import Event


class NotSupported(Exception):
    """The peer runs older code without GET /sync/summary: ask it for ids instead."""


class Transport(Protocol):
    # The peer's ids, with its fingerprint when it sends one (older hubs send ids only).
    def ids(self, peer: str) -> set[str] | tuple[set[str], str | None]: ...
    def push(self, peer: str, events: list[Event]) -> dict: ...
    # Optional: the peer's per-origin summary and fingerprint (Syncer falls back to ids).
    # def summary(self, peer: str) -> tuple[dict, str | None]: ...


def missing(held: list[Event], view: tuple[str, object], delivered: set[str] | None = None) -> list[Event]:
    """The events in `held` that the peer, as last seen (`view`), doesn't have. `delivered`:
    ids this hub already pushed to that peer, so a chain that differs is offered only once."""
    kind, theirs = view
    if kind == "ids":
        return [e for e in held if e.id not in theirs]
    out = []
    for origin, evs in by_origin(held).items():
        mine = chain_prefix(evs)
        t = theirs.get(origin) or {"n": 0, "head": GENESIS}
        n, head, first = int(t.get("n", 0)), str(t.get("head", GENESIS))[:SHORT], str(t.get("first", ""))[:SHORT]
        if n == 0:
            skip = set()
        elif n <= len(mine) and mine[n - 1].hash[:SHORT] == head:
            skip = {e.id for e in mine[:n]}  # they hold exactly our first n
        elif n > len(mine) and mine and mine[0].hash[:SHORT] == first:
            skip = {e.id for e in mine}  # the same chain, and they're further along it than our gap
        else:
            # Their chain differs from ours (a wiped hub restarting its chain, or an edit):
            # offer what they haven't had from us yet, and let their gate decide.
            skip = set(delivered or ())
        out += [e for e in evs if e.id not in skip]
    return out


class HttpTransport:
    def __init__(self, timeout_s: float = 5.0):
        self.client = httpx.Client(timeout=timeout_s)

    def ids(self, peer: str) -> tuple[set[str], str | None]:
        r = self.client.get(f"{peer.rstrip('/')}/sync/ids")
        r.raise_for_status()
        body = r.json()
        return set(body["ids"]), body.get("fingerprint")

    def summary(self, peer: str, mine: str | None = None) -> tuple[dict | None, str | None]:
        """The peer's summary, or None if it holds exactly what we hold (`mine` = our fingerprint)."""
        r = self.client.get(f"{peer.rstrip('/')}/sync/summary", params={"unless": mine} if mine else None)
        if r.status_code == 404:
            raise NotSupported(peer)
        r.raise_for_status()
        body = r.json()
        return (None if body.get("same") else body["origins"]), body.get("fingerprint")

    def push(self, peer: str, events: list[Event]) -> dict:
        r = self.client.post(
            f"{peer.rstrip('/')}/sync/events", json=[e.model_dump(mode="json") for e in events]
        )
        r.raise_for_status()
        return r.json()


class Syncer:
    def __init__(self, log: EventLog, gate: Gate, link: Link, peers: list[str], transport: Transport):
        self.log, self.gate, self.link = log, gate, link
        self.peers = [p for p in peers if p]
        self.transport = transport
        self.in_flight: set[str] = set()
        # What each peer last said it holds: ("summary", {origin: {n, head}}) or ("ids", {id, ...})
        self.peer_view: dict[str, tuple[str, object]] = {}
        self.ids_only: set[str] = set()  # peers on older code, asked for ids
        self.delivered: dict[str, set[str]] = {}  # ids pushed to each peer that it answered for
        self.refused: dict[str, set[str]] = {}  # ids each peer refused: not sent to it again
        self.peer_fingerprint: dict[str, str | None] = {}  # from the peer's last id list
        self.last_ok: dict[str, float] = {}
        self.last_error: dict[str, str] = {}
        self._lock = threading.Lock()  # guards the link and in_flight; never held during a push
        self._stop = threading.Event()

    # ------------------------------------------------------------------ sending

    def deliver(self, events: list[Event]) -> None:
        """Push events that finished crossing the link to every peer. Whatever happens,
        they leave in_flight: pushed ones are done, failed ones get queued again next tick."""
        if not events:
            return
        for peer in self.peers:
            try:
                reply = self.transport.push(peer, events) or {}
                self._ok(peer)
                with self._lock:
                    if reply.get("refused"):
                        self.refused.setdefault(peer, set()).update(reply["refused"])
                    self.delivered.setdefault(peer, set()).update(e.id for e in events)
            except Exception as err:  # peer down or unreachable: retried next tick
                self.last_error[peer] = str(err)
        with self._lock:
            self.in_flight.difference_update(e.id for e in events)

    def link_control(self, action) -> dict:
        """Run a link control (cut, restore, set_bandwidth) for POST /link. Events that
        finished crossing before the change are pushed, never dropped."""
        with self._lock:
            done = action(self.link) or []
            status = self.link.status()
        self.deliver(done)
        return status

    def _poll(self) -> list[Event]:
        with self._lock:
            return self.link.poll()

    def _ask(self, peer: str) -> tuple[tuple[str, object], str | None]:
        """What the peer holds: its summary, or its id list if it runs older code."""
        if peer not in self.ids_only and hasattr(self.transport, "summary"):
            try:
                summary, fp = self.transport.summary(peer, self.log.fingerprint())
                # "Same as you": right now it holds exactly what we hold, so our own summary
                # is its summary (and stays the baseline if the link is cut next).
                return ("summary", self.log.summary() if summary is None else summary), fp
            except NotSupported:
                self.ids_only.add(peer)
        reply = self.transport.ids(peer)
        theirs, fp = reply if isinstance(reply, tuple) else (reply, None)
        return ("ids", theirs), fp

    def tick(self) -> None:
        self.deliver(self._poll())
        held = None
        for peer in self.peers:
            if self.link.is_cut:
                # Nothing crosses a cut link, not even the question. Queue against what the
                # peer last said it holds, so the backlog shows in GET /link ("queued")
                # and drains when the link is restored.
                view = self.peer_view.get(peer)
                if view is None:
                    continue
            else:
                try:
                    view, fp = self._ask(peer)
                    self.peer_view[peer], self.peer_fingerprint[peer] = view, fp
                    self._ok(peer)
                except Exception as err:
                    self.last_error[peer] = str(err)
                    self.peer_fingerprint.pop(peer, None)
                    continue
            held = held if held is not None else self.log.list()
            todo = missing(held, view, self.delivered.get(peer))
            with self._lock:
                refused = self.refused.get(peer, set())
                for e in todo:
                    if e.id not in self.in_flight and e.id not in refused:
                        # Roster events go first, so members are known before their events land.
                        self.link.enqueue(e.model_copy(update={"priority": 1.0}) if e.type == "roster" else e)
                        self.in_flight.add(e.id)
        self.deliver(self._poll())

    def _ok(self, peer: str) -> None:
        self.last_ok[peer] = time.time()
        self.last_error.pop(peer, None)

    # ------------------------------------------------------------------ receiving

    def receive(self, events: list[Event]) -> dict:
        """Counts per outcome, plus the ids refused (the sender won't offer them again)."""
        counts = {"stored": 0, "restored": 0, "duplicate": 0, "deferred": 0, "rejected": 0}
        refused = []
        for e in events:
            try:
                counts[self.gate.admit_synced(e)] += 1
            except Rejected:
                counts["rejected"] += 1
                refused.append(e.id)
        return {**counts, "refused": refused}

    # ------------------------------------------------------------------ loop

    def run_forever(self, interval_s: float) -> None:
        while not self._stop.wait(interval_s):
            try:
                self.tick()
            except Exception as err:  # never let one bad tick stop sync
                self.last_error["tick"] = str(err)

    def start(self, interval_s: float) -> threading.Thread:
        t = threading.Thread(target=self.run_forever, args=(interval_s,), name="sync", daemon=True)
        t.start()
        return t

    def stop(self) -> None:
        self._stop.set()

    def agrees_with(self) -> dict[str, bool | None]:
        """Per peer: does it hold exactly the events we hold? None = can't tell right now
        (link cut, peer not answering, or a peer on older code that sends no fingerprint)."""
        if self.link.is_cut:
            return {p: None for p in self.peers}
        mine = self.log.fingerprint()
        return {p: (None if self.peer_fingerprint.get(p) is None else self.peer_fingerprint[p] == mine)
                for p in self.peers}

    def status(self) -> dict:
        return {
            "fingerprint": self.log.fingerprint(),
            "agrees_with": self.agrees_with(),
            "peers": [
                {"url": p, "last_ok": self.last_ok.get(p), "error": self.last_error.get(p)} for p in self.peers
            ],
            "in_flight": len(self.in_flight),
            "restored": self.gate.restored,
            "refused": {p: len(ids) for p, ids in self.refused.items()},
            "link": self.link.status(),
            "gaps": self.log.verify_report()["gaps"],
        }


def make_router(syncer: Syncer) -> APIRouter:
    router = APIRouter(prefix="/sync", tags=["sync"])

    @router.get("/ids")
    def sync_ids():
        """Every event id this hub holds. Peers use it to work out what to send."""
        return {"hub_id": syncer.log.hub_id, "ids": syncer.log.ids(), "fingerprint": syncer.log.fingerprint()}

    @router.get("/summary")
    def sync_summary(unless: str | None = None):
        """Per origin hub: how many of its events this hub holds with no gap, and the last
        one's hash. A few bytes per hub; peers use it instead of the full id list. With
        ?unless=<the asker's fingerprint>, a hub holding exactly the same events just says so."""
        fp = syncer.log.fingerprint()
        if unless and unless == fp:
            return {"hub_id": syncer.log.hub_id, "same": True, "fingerprint": fp}
        return {"hub_id": syncer.log.hub_id, "origins": syncer.log.summary(), "fingerprint": fp}

    @router.post("/events")
    def sync_events(events: list[Event]):
        """Events from a peer. Each goes through Gate.admit_synced()."""
        if len(events) > 5000:
            raise HTTPException(413, "send at most 5000 events at a time")
        return syncer.receive(events)

    @router.get("/status")
    def sync_status():
        """Peers, last success, events in flight, link state, gaps per origin hub."""
        return syncer.status()

    return router
