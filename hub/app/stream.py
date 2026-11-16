"""Live event stream (Server-Sent Events) for the dashboard.

The browser opens one long-lived GET /events/stream and receives each new event
as it's stored. If the connection drops, the browser's EventSource reconnects on
its own and sends the last id it saw (Last-Event-ID), so nothing is missed.

    const es = new EventSource(`${HUB_URL}/events/stream`);
    es.onmessage = (m) => addToQueue(JSON.parse(m.data));
"""

import asyncio
from collections.abc import AsyncIterator

from .log import EventLog

POLL_S = 0.5
KEEPALIVE_S = 15.0


def format_sse(seq: int, data: str) -> str:
    return f"id: {seq}\ndata: {data}\n\n"


async def event_stream(
    log: EventLog,
    last_seq: int = 0,
    type: str | None = None,
    level: int | None = None,
    poll_s: float = POLL_S,
    max_polls: int | None = None,  # tests stop the stream; real clients just disconnect
) -> AsyncIterator[str]:
    idle_s, polls = 0.0, 0
    while max_polls is None or polls < max_polls:
        polls += 1
        batch = await asyncio.to_thread(log.after, last_seq, type, level)
        for seq, event in batch:
            last_seq = seq
            yield format_sse(seq, event.model_dump_json())
        if batch:
            idle_s = 0.0
        else:
            idle_s += poll_s
            if idle_s >= KEEPALIVE_S:  # stops proxies from closing an idle connection
                idle_s = 0.0
                yield ": keepalive\n\n"
        await asyncio.sleep(poll_s)
