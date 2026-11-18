"""Hub-to-hub sync: no alert is lost or duplicated, whether the link is up, cut or coming back.

Merge = union by event id. Each tick, a hub asks every peer which event ids it holds
(GET /sync/ids), queues the events the peer is missing on its outbound link
(hub/app/link.py), and pushes whatever has finished crossing the link to its peers
(POST /sync/events). The receiver runs every event through Gate.admit_synced():
signature, roster, hash, and "do we already hold this exact event".

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
sent, so the backlog shows in GET /link ("queued") and drains on restore. One outbound link per hub, pushed to every peer: right for the
two-hub demo (multi-hop is out of scope).

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
from .log import EventLog
from .models import Event


class Transport(Protocol):
    def ids(self, peer: str) -> set[str]: ...
    def push(self, peer: str, events: list[Event]) -> dict: ...


class HttpTransport:
    def __init__(self, timeout_s: float = 5.0):
        self.client = httpx.Client(timeout=timeout_s)

    def ids(self, peer: str) -> set[str]:
        r = self.client.get(f"{peer.rstrip('/')}/sync/ids")
        r.raise_for_status()
        return set(r.json()["ids"])

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
        self.peer_ids: dict[str, set[str]] = {}  # the last id list each peer sent
        self.refused: dict[str, set[str]] = {}  # ids each peer refused: not sent to it again
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
                if reply.get("refused"):
                    with self._lock:
                        self.refused.setdefault(peer, set()).update(reply["refused"])
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

    def tick(self) -> None:
        self.deliver(self._poll())
        held = None
        for peer in self.peers:
            if self.link.is_cut:
                # Nothing crosses a cut link, not even the list of ids. Queue against the
                # last list the peer sent, so the backlog shows in GET /link ("queued")
                # and drains when the link is restored.
                theirs = self.peer_ids.get(peer)
                if theirs is None:
                    continue
            else:
                try:
                    theirs = self.peer_ids[peer] = self.transport.ids(peer)
                    self._ok(peer)
                except Exception as err:
                    self.last_error[peer] = str(err)
                    continue
            held = held if held is not None else self.log.list()
            with self._lock:
                refused = self.refused.get(peer, set())
                for e in held:
                    if e.id not in theirs and e.id not in self.in_flight and e.id not in refused:
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

    def status(self) -> dict:
        return {
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
        return {"hub_id": syncer.log.hub_id, "ids": syncer.log.ids()}

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
