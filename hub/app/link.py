"""Simulated slow link between hubs (Person 1).

One outbound link per hub. Events wait in a queue and cross one at a time at
`bandwidth_bps` bytes per second, highest priority first (ties: oldest first).
Taheful's bandwidth slider and "cut the network" button drive it through
GET/POST /link. sync.py will drain it with `poll()` once hub-to-hub sync exists.

- cut():     nothing crosses; an event caught mid-send is re-queued, not lost.
- restore(): sending resumes from now.
- bandwidth_bps=None means unlimited (instant).

Fairness (no level waits too long) is Person 2's Upgrade 2: hub/app/scheduler.py.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import count

from .models import Event


def event_size(event: Event) -> int:
    """Bytes on the wire: the event as JSON."""
    return len(event.model_dump_json().encode())


@dataclass
class _Queued:
    event: Event
    size: int
    enqueued_at: float
    order: int  # tie-break: earlier first

    @property
    def priority(self) -> float:
        return self.event.priority if self.event.priority is not None else 0.0


@dataclass
class Link:
    bandwidth_bps: float | None = None
    clock: Callable[[], float] = time.monotonic
    is_cut: bool = False
    _queue: list[_Queued] = field(default_factory=list)
    _sending: tuple[_Queued, float] | None = None  # (item, finishes_at)
    _free_at: float = 0.0
    _order: count = field(default_factory=count)

    # ------------------------------------------------------------------ controls

    def enqueue(self, event: Event) -> None:
        self._queue.append(_Queued(event, event_size(event), self.clock(), next(self._order)))

    def set_bandwidth(self, bps: float | None) -> list[Event]:
        """Change speed from now on. Returns anything that finished at the old speed."""
        if bps is not None and bps <= 0:
            raise ValueError("bandwidth must be positive, or None for unlimited")
        done = self.poll()
        if self._sending:  # restart the in-flight event at the new speed
            self._queue.append(self._sending[0])
            self._sending = None
        self._free_at = self.clock()
        self.bandwidth_bps = bps
        return done

    def cut(self) -> list[Event]:
        """Stop the link. Returns what finished before the cut; the in-flight event is re-queued."""
        done = self.poll()
        if self._sending:
            self._queue.append(self._sending[0])
            self._sending = None
        self.is_cut = True
        return done

    def restore(self) -> None:
        self.is_cut = False
        self._free_at = self.clock()

    # ------------------------------------------------------------------ sending

    def _seconds(self, size: int) -> float:
        return 0.0 if self.bandwidth_bps is None else size / self.bandwidth_bps

    def _next(self) -> _Queued | None:
        """Highest priority among events that had arrived when the link came free."""
        if not self._queue:
            return None
        start = max(self._free_at, min(q.enqueued_at for q in self._queue))
        ready = [q for q in self._queue if q.enqueued_at <= start]
        best = max(ready, key=lambda q: (q.priority, -q.order))
        self._queue.remove(best)
        self._free_at = start
        return best

    def poll(self) -> list[Event]:
        """Events that have fully crossed the link by now, in delivery order."""
        delivered = []
        now = self.clock()
        while not self.is_cut:
            if self._sending is None:
                item = self._next()
                if item is None:
                    break
                self._sending = (item, self._free_at + self._seconds(item.size))
            item, finishes_at = self._sending
            if finishes_at > now:
                break
            delivered.append(item.event)
            self._sending = None
            self._free_at = finishes_at
        return delivered

    def status(self) -> dict:
        return {
            "bandwidth_bps": self.bandwidth_bps,
            "cut": self.is_cut,
            "queued": len(self._queue) + (1 if self._sending else 0),
            "queued_bytes": sum(q.size for q in self._queue) + (self._sending[0].size if self._sending else 0),
        }
