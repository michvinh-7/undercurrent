"""Undercurrent hub: starter API.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .log import EventLog
from .models import Event, EventIn, EventType

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


@app.get("/health")
def health():
    intact, _ = log.verify()
    return {"hub_id": HUB_ID, "events": log.count(), "chain_intact": intact}


@app.post("/events", response_model=Event, status_code=201)
def add_event(event: EventIn):
    return log.append(event)


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
