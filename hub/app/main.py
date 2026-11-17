"""Undercurrent hub: starter API.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from .ai_routes import router as ai_router
from .gate import Gate, Rejected
from .link import Link
from .log import EventLog
from .models import Event, EventIn, EventType
from .roster import Roster
from .stream import event_stream

load_dotenv()

HUB_ID = os.getenv("HUB_ID", "hub-L38")
HUB_DB = os.getenv("HUB_DB", "hub.db")

app = FastAPI(title="Undercurrent hub", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hubs run on local networks; tighten for the online mirror
    allow_methods=["*"],
    allow_headers=["*"],
)

log = EventLog(HUB_DB, HUB_ID)
gate = Gate(log, Roster.from_env(), HUB_ID)  # signature, roster and replay checks (hub/app/gate.py)
app.include_router(ai_router)  # POST /triage, POST /organize
_bps = float(os.getenv("LINK_BANDWIDTH_BPS", "0") or 0)
link = Link(bandwidth_bps=_bps or None)  # outbound link to peer hubs; sync.py will drain it


@app.get("/health")
def health():
    intact, _ = log.verify()
    return {"hub_id": HUB_ID, "events": log.count(), "chain_intact": intact}


@app.post("/events", response_model=Event, status_code=201)
def add_event(event: EventIn):
    """Checks the event (hub/app/gate.py), scores its priority (hub/app/ingest.py), stores it.
    A failed check returns 403 with the reason and is listed in GET /rejected."""
    try:
        return gate.admit(event, fresh=True)
    except Rejected as r:
        raise HTTPException(403, r.reason) from None


@app.get("/rejected")
def list_rejected(limit: int = Query(default=100, ge=1, le=1000)):
    """Events that failed the checks, newest first. `total` feeds the "forgeries blocked" counter."""
    total, items = log.rejected(limit)
    return {"total": total, "rejected": items}


@app.get("/roster")
def get_roster():
    return {"require_signed": gate.require_signed, "members": gate.roster.snapshot()}


@app.post("/roster", response_model=Event, status_code=201)
def add_roster_event(event: EventIn):
    """Add or remove a member. The event must be type "roster" and signed by an operator."""
    if event.type != "roster":
        raise HTTPException(422, 'type must be "roster"')
    return add_event(event)


@app.get("/events", response_model=list[Event])
def list_events(
    type: EventType | None = None,
    level: int | None = Query(default=None, ge=1, le=40),
    since: str | None = Query(default=None, description="ISO time; only events after it"),
):
    return log.list(type=type, level=level, since=since)


@app.get("/events/verify")
def verify_chain():
    intact, first_bad = log.verify()
    return {"chain_intact": intact, "first_bad_event": first_bad}


@app.get("/events/stream")
async def stream_events(
    type: EventType | None = None,
    level: int | None = Query(default=None, ge=1, le=40),
    after: int = Query(default=0, ge=0, description="Start after this event position (0 = from the beginning)"),
    last_event_id: str | None = Header(default=None),
):
    """Server-Sent Events: every stored event, then each new one as it arrives.
    Browsers reconnect on their own and resume from Last-Event-ID."""
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    return StreamingResponse(
        event_stream(log, start, type, level),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class LinkSettings(BaseModel):
    bandwidth_bps: float | None = Field(default=None, gt=0, description="Bytes per second; omit to leave unchanged")
    unlimited: bool = False
    cut: bool | None = Field(default=None, description="true = cut the network, false = restore")


@app.get("/link")
def link_status():
    return link.status()


@app.post("/link")
def set_link(settings: LinkSettings):
    """For the dashboard's bandwidth slider and "cut the network" button."""
    if settings.unlimited and settings.bandwidth_bps is not None:
        raise HTTPException(422, "send bandwidth_bps or unlimited, not both")
    if settings.unlimited:
        link.set_bandwidth(None)
    elif settings.bandwidth_bps is not None:
        link.set_bandwidth(settings.bandwidth_bps)
    if settings.cut is True:
        link.cut()
    elif settings.cut is False:
        link.restore()
    return link.status()
