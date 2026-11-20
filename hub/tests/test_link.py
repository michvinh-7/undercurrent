import pytest

from app.link import Link, event_size
from app.models import Event


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def ev(name: str, priority: float | None) -> Event:
    return Event(id=name, type="checkin", level=1, author="a", payload={}, priority=priority,
                 hub_id="h", created_at="2087-01-01T00:00:00Z", prev_hash="x", hash="y")


@pytest.fixture
def clock():
    return Clock()


def test_unlimited_sends_everything_by_priority(clock):
    link = Link(clock=clock)
    for name, p in [("routine", 0.2), ("sos", 0.95), ("urgent", 0.7)]:
        link.enqueue(ev(name, p))
    assert [e.id for e in link.poll()] == ["sos", "urgent", "routine"]


def test_bandwidth_sets_delivery_time(clock):
    e = ev("a", 0.5)
    link = Link(bandwidth_bps=100, clock=clock)
    link.enqueue(e)
    clock.t = event_size(e) / 100 - 0.01
    assert link.poll() == []
    clock.t += 0.02
    assert [x.id for x in link.poll()] == ["a"]


def test_sos_jumps_the_queue_but_not_the_event_already_sending(clock):
    link = Link(bandwidth_bps=10, clock=clock)
    link.enqueue(ev("routine-1", 0.2))
    link.poll()  # routine-1 starts sending now
    link.enqueue(ev("routine-2", 0.2))
    link.enqueue(ev("sos", 0.95))
    clock.t = 10_000
    assert [e.id for e in link.poll()] == ["routine-1", "sos", "routine-2"]


def test_unscored_events_go_last_in_arrival_order(clock):
    link = Link(clock=clock)
    link.enqueue(ev("unscored-1", None))
    link.enqueue(ev("unscored-2", None))
    link.enqueue(ev("scored", 0.1))
    assert [e.id for e in link.poll()] == ["scored", "unscored-1", "unscored-2"]


def test_cut_loses_nothing(clock):
    link = Link(bandwidth_bps=10, clock=clock)
    for i in range(3):
        link.enqueue(ev(f"e{i}", 0.5))
    link.poll()
    clock.t = 1  # e0 is mid-send
    assert link.cut() == []
    clock.t = 10_000
    assert link.poll() == []  # nothing crosses while cut
    assert link.status()["queued"] == 3
    link.restore()
    clock.t = 20_000
    assert sorted(e.id for e in link.poll()) == ["e0", "e1", "e2"]


def test_slider_change_applies_from_now(clock):
    e = ev("a", 0.5)
    link = Link(bandwidth_bps=1, clock=clock)
    link.enqueue(e)
    link.poll()
    clock.t = 5
    link.set_bandwidth(1_000_000)
    clock.t = 5.01
    assert [x.id for x in link.poll()] == ["a"]


def test_bad_bandwidth_rejected(clock):
    with pytest.raises(ValueError):
        Link(clock=clock).set_bandwidth(0)



def test_fair_link_serves_a_starved_deep_level_but_sos_still_goes_first(clock):
    """With fair_max_wait_s (on in every hub), a level whose message has waited past the
    limit goes next, ahead of higher-priority messages from busier levels. SOS still first."""
    def at(name, priority, level):
        return ev(name, priority).model_copy(update={"level": level})

    orders = {}
    for name, link in {"plain": Link(bandwidth_bps=1, clock=clock),
                       "fair": Link(bandwidth_bps=1, clock=clock, fair_max_wait_s=60)}.items():
        clock.t = 0.0
        for e in (at("sos", 0.95, 12), at("upper-a", 0.65, 3), at("deep", 0.25, 38), at("upper-b", 0.65, 3)):
            link.enqueue(e)  # each takes ~200 s to cross at 1 byte/s
        clock.t = 10_000
        orders[name] = [e.id for e in link.poll()]
    assert orders["plain"] == ["sos", "upper-a", "upper-b", "deep"]  # the deep level always loses
    # Past 60 s, each level's oldest message gets a turn, longest-waiting first: L3's first, then
    # the deep level's, before L3's second.
    assert orders["fair"] == ["sos", "upper-a", "deep", "upper-b"]
