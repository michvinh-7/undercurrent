"""Fair scheduler (Person 2, Upgrade 2).

Decides what crosses a slow link next: urgent first, but no level waits longer
than a set limit.

    1. SOS (priority >= 0.9) always goes first. Life over fairness.
    2. Otherwise, if any level's oldest waiting message has waited max_wait_s or
       more, send the one that has waited longest (the most-starved level).
    3. Otherwise, highest priority first; ties go to whoever arrived first.

Works on anything with the fields hub/app/link.py queues carry: `priority`,
`enqueued_at`, `order` and `event.level`. On in every hub: Link(fair_max_wait_s=60)
picks with `pick()` (main.py; LINK_FAIR_MAX_WAIT_S=0 turns it off).
"""

from collections.abc import Sequence
from typing import Protocol

SOS_FLOOR = 0.9  # matches the SOS band in triage.score()
DEFAULT_MAX_WAIT_S = 60.0


class _Event(Protocol):
    level: int


class Queued(Protocol):
    event: _Event
    enqueued_at: float
    order: int

    @property
    def priority(self) -> float: ...


def pick(queue: Sequence[Queued], now: float, max_wait_s: float = DEFAULT_MAX_WAIT_S) -> Queued | None:
    """The next message to send, or None if the queue is empty. Doesn't modify the queue."""
    if not queue:
        return None

    sos = [q for q in queue if q.priority >= SOS_FLOOR]
    if sos:
        return max(sos, key=lambda q: (q.priority, -q.order))

    oldest_per_level: dict[int, Queued] = {}
    for q in queue:
        cur = oldest_per_level.get(q.event.level)
        if cur is None or q.order < cur.order:
            oldest_per_level[q.event.level] = q
    starved = [q for q in oldest_per_level.values() if now - q.enqueued_at >= max_wait_s]
    if starved:
        return min(starved, key=lambda q: q.order)  # longest-waiting first

    return max(queue, key=lambda q: (q.priority, -q.order))
