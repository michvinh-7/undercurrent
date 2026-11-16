"""Score reports as they arrive (Person 2).

The hub calls `score(event)` in POST /events before appending, so every report is
stored with a priority. priority isn't part of the hash, but scoring before the
append means the stored event never changes afterwards.

Phone reports are structured (buttons, fields), so we rebuild a short message
from the payload and triage that. If the local model is down or slow to answer,
triage falls back to keyword rules: a report is never rejected or held back.
Set TRIAGE_ON_INGEST=0 to switch this off.
"""

import os

from .models import EventIn
from .triage import triage


def message_text(e: EventIn) -> str:
    """A plain-language version of the report for triage."""
    p = e.payload
    raw = p.get("raw_text") or p.get("note") or p.get("description") or ""
    if e.type == "checkin":
        head = "I need help." if p.get("status") == "need_help" else "Checking in, I'm OK."
    elif e.type == "hazard":
        head = f"Hazard: {str(p.get('kind', 'unknown')).replace('_', ' ')}, severity {p.get('severity', 'unknown')}."
        if p.get("location"):
            head += f" At {p['location']}."
    elif e.type == "case":
        symptoms = ", ".join(p.get("symptoms") or [])
        people = p.get("people_affected")
        head = f"Symptoms: {symptoms}." if symptoms else "Someone is sick."
        if people:
            head += f" {people} people affected."
    else:  # missing_person
        head = f"Missing person: {p.get('name', 'unknown')}, last seen on level {p.get('last_seen_level', '?')}."
    return f"Level {e.level}. {head} {raw}".strip()


def score(e: EventIn) -> EventIn:
    """The same event with a priority, unless it already has one (e.g. synced from another hub)."""
    if e.priority is not None or os.getenv("TRIAGE_ON_INGEST", "1") == "0":
        return e
    return e.model_copy(update={"priority": triage(message_text(e), level_hint=e.level).priority})
