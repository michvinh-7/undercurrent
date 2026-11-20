"""Undercurrent hub API.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
Two hubs that sync: HUB_ID=hub-L34 HUB_DB=l34.db HUB_PEERS=http://localhost:8002 uvicorn app.main:app --port 8001
                    HUB_ID=hub-L12 HUB_DB=l12.db HUB_PEERS=http://localhost:8001 uvicorn app.main:app --port 8002
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from .ai_routes import router as ai_router
from .exchange import board as exchange_board
from .forecast import CUTOFF_V, forecast_all
from .livability import livability
from .wellbeing import wellbeing
from .gate import Gate, Rejected
from .link import Link
from .log import EventLog
from .models import Event, EventIn, EventType
from .roster import Roster
from .stream import event_stream
from .sync import HttpTransport, Syncer, make_router

load_dotenv()

HUB_ID = os.getenv("HUB_ID", "hub-L38")
HUB_DB = os.getenv("HUB_DB", "hub.db")
HUB_PEERS = [p.strip() for p in os.getenv("HUB_PEERS", "").split(",") if p.strip()]
SYNC_INTERVAL_S = float(os.getenv("SYNC_INTERVAL_S", "1") or 1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if HUB_PEERS:  # sync runs in a background thread only when there are peers
        syncer.start(SYNC_INTERVAL_S)
    yield
    syncer.stop()


app = FastAPI(title="Undercurrent hub", version="0.2.0", lifespan=lifespan)
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
link = Link(bandwidth_bps=_bps or None)  # outbound link to peer hubs, drained by sync
syncer = Syncer(log, gate, link, HUB_PEERS, HttpTransport())
app.include_router(make_router(syncer))  # GET /sync/ids, POST /sync/events, GET /sync/status


@app.get("/health")
def health():
    intact, _ = log.verify()
    return {"hub_id": HUB_ID, "events": log.count(), "chain_intact": intact, "fingerprint": log.fingerprint()}


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


@app.get("/forecast")
def blackout_forecast(cutoff: float = Query(default=CUTOFF_V, ge=0, le=400, description="Volts where equipment drops out")):
    """Per box that reports volts: a straight-line fit of its recent readings and, if the
    supply is clearly falling, when it reaches the cutoff (hub/app/forecast.py)."""
    return {"cutoff_v": cutoff, "boxes": [f.to_dict() for f in forecast_all(log.list(type="hazard"), cutoff)]}


@app.get("/exchange")
def have_need_board():
    """The Have / Need board: open needs and offers, suggested matches, counts per level
    (hub/app/exchange.py)."""
    return exchange_board(log.list(type="exchange"))


@app.get("/wellbeing")
def sleep_mood_roll_call(window_h: float = Query(default=24, gt=0, le=24 * 7, description="Hours that count as today")):
    """Sleep and mood per level from daily check-ins (shown only when at least 2 people
    answered), and the roll call: residents heard from this week but not in the window
    (hub/app/wellbeing.py)."""
    return wellbeing(log.list(), window_h)


@app.get("/livability")
def livability_index(window_h: float = Query(default=6, gt=0, le=24 * 7, description="Hours of readings and reports that count")):
    """The Livability Index: one 0-100 score per level from signed readings, reports, the
    blackout forecast, the Have / Need board and check-ins, each number traceable to its
    events (hub/app/livability.py)."""
    return livability(log.list(), window_h)


@app.get("/events/verify")
def verify_chain():
    """chain_intact + the first bad event; gaps = events per origin hub whose predecessor
    hasn't arrived yet (normal mid-sync, 0 once sync settles)."""
    return log.verify_report()


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
    # Through the syncer: events that finished crossing before the change get pushed, not dropped.
    if settings.unlimited:
        syncer.link_control(lambda l: l.set_bandwidth(None))
    elif settings.bandwidth_bps is not None:
        syncer.link_control(lambda l: l.set_bandwidth(settings.bandwidth_bps))
    if settings.cut is True:
        syncer.link_control(lambda l: l.cut())
    elif settings.cut is False:
        syncer.link_control(lambda l: l.restore())
    return syncer.link_control(lambda l: None)
