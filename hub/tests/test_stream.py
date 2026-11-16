import asyncio
import json

from app.log import EventLog
from app.models import EventIn
from app.stream import event_stream


def collect(log, **kwargs):
    async def run():
        return [chunk async for chunk in event_stream(log, poll_s=0, max_polls=1, **kwargs)]
    return asyncio.run(run())


def test_after_returns_positions_in_order(tmp_path):
    log = EventLog(str(tmp_path / "t.db"), "hub-test")
    for lvl in (1, 2, 3):
        log.append(EventIn(type="checkin", level=lvl, author="a", payload={"status": "ok"}))
    assert [(seq, e.level) for seq, e in log.after(1)] == [(2, 2), (3, 3)]
    assert [e.level for _, e in log.after(0, level=3)] == [3]


def test_stream_sends_sse_with_resumable_ids(tmp_path):
    log = EventLog(str(tmp_path / "t.db"), "hub-test")
    first = log.append(EventIn(type="hazard", level=38, author="a", payload={"kind": "flooding", "severity": "high"}))
    log.append(EventIn(type="checkin", level=12, author="b", payload={"status": "ok"}))

    chunks = collect(log)
    assert chunks[0].startswith("id: 1\ndata: ") and chunks[0].endswith("\n\n")
    assert json.loads(chunks[0].split("data: ", 1)[1])["id"] == first.id

    # a reconnecting browser sends Last-Event-ID: 1 and only gets what it missed
    assert [c.split("\n")[0] for c in collect(log, last_seq=1)] == ["id: 2"]


def test_stream_filters_by_type(tmp_path):
    log = EventLog(str(tmp_path / "t.db"), "hub-test")
    log.append(EventIn(type="checkin", level=1, author="a", payload={"status": "ok"}))
    log.append(EventIn(type="hazard", level=1, author="a", payload={"kind": "heat", "severity": "low"}))
    chunks = collect(log, type="hazard")
    assert len(chunks) == 1 and '"type":"hazard"' in chunks[0]
