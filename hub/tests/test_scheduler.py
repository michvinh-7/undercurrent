from dataclasses import dataclass

from app.scheduler import pick


@dataclass
class Ev:
    level: int


@dataclass
class Q:
    name: str
    priority: float
    level: int
    enqueued_at: float
    order: int

    @property
    def event(self):
        return Ev(self.level)


def q(name, priority, level, t, order=None):
    return Q(name, priority, level, t, order if order is not None else int(t * 1000))


def test_empty_queue():
    assert pick([], now=0) is None


def test_urgent_first_when_nobody_is_starved():
    queue = [q("routine", 0.25, 3, 0), q("urgent", 0.7, 5, 1)]
    assert pick(queue, now=10, max_wait_s=60).name == "urgent"


def test_starved_level_is_served_once_over_the_limit():
    queue = [q("old-routine-L40", 0.25, 40, 0), q("urgent-L5", 0.7, 5, 50)]
    assert pick(queue, now=59, max_wait_s=60).name == "urgent-L5"
    assert pick(queue, now=60, max_wait_s=60).name == "old-routine-L40"


def test_sos_beats_a_starved_level():
    queue = [q("starved", 0.25, 40, 0), q("sos", 0.95, 5, 100)]
    assert pick(queue, now=500, max_wait_s=60).name == "sos"


def test_most_starved_level_goes_first():
    queue = [q("L7-waited-90", 0.25, 7, 10), q("L9-waited-100", 0.25, 9, 0)]
    assert pick(queue, now=100, max_wait_s=60).name == "L9-waited-100"


def test_ties_are_first_come_first_served():
    queue = [q("second", 0.5, 1, 2), q("first", 0.5, 2, 1)]
    assert pick(queue, now=3).name == "first"
