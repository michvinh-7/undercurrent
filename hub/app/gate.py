"""The checks every event passes before a hub stores it.

POST /events and sync both go through Gate.admit():

    gate.admit(event, fresh=True)    # POST /events: a report arriving now
    gate.admit(event, fresh=False)   # sync: an event another hub already accepted

Checks, in order: signature, roster, replay (duplicate id), then for fresh events
only: addressed to this hub, and created_at within REPLAY_WINDOW_S of the hub's clock.
Sync skips the time window on purpose: alerts queued during a cut arrive late and
must still be accepted. Duplicate ids still catch replays there.

Anything that fails is stored in the rejected table with its reason (GET /rejected)
and raises Rejected. Unsigned events pass only while REQUIRE_SIGNED=0.
"""

import os
import sqlite3
from datetime import datetime, timezone

from . import crypto
from .ingest import score
from .log import EventLog
from .models import Event, EventIn
from .roster import Roster


class Rejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _parse_time(text: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


class Gate:
    def __init__(self, log: EventLog, roster: Roster, hub_id: str,
                 require_signed: bool | None = None, window_s: float | None = None):
        self.log, self.roster, self.hub_id = log, roster, hub_id
        self.require_signed = (os.getenv("REQUIRE_SIGNED", "0") == "1") if require_signed is None else require_signed
        self.window_s = float(os.getenv("REPLAY_WINDOW_S", "300")) if window_s is None else window_s
        for event in log.list(type="roster"):  # rebuild membership changes from the log
            self.roster.apply(event.payload)

    def check(self, e: EventIn, fresh: bool, now: datetime | None = None) -> str | None:
        """Why this event must be rejected, or None if it may be stored."""
        if e.id is not None and self.log.has(e.id):
            return "replay: duplicate id"
        if e.type == "roster":
            if e.sig is None:
                return "roster: must be signed by an operator"
            if bad := self.roster.invalid(e.payload):
                return bad
        if e.sig is None:
            return "unsigned" if self.require_signed else None

        if not (e.id and e.created_at and e.hub_id and e.author_pub):
            return "signed event missing id, created_at, hub_id or author_pub"
        if not crypto.verify(e.model_dump()):
            return "bad signature"
        if e.type == "roster":
            if not self.roster.is_operator(e.author_pub):
                return "roster: signer is not an operator"
        elif not self.roster.is_member(e.author_pub):
            return "unknown key"

        if fresh:
            if e.hub_id != self.hub_id:
                return f"addressed to {e.hub_id}, not this hub"
            t = _parse_time(e.created_at)
            if t is None:
                return "created_at is not an ISO time with a timezone"
            now = now or datetime.now(timezone.utc)
            if abs((now - t).total_seconds()) > self.window_s:
                return "replay: outside the time window"
        return None

    def admit(self, e: EventIn, fresh: bool = True, now: datetime | None = None) -> Event:
        if reason := self.check(e, fresh, now):
            self.log.reject(e, reason, fresh)
            raise Rejected(reason)
        try:
            stored = self.log.append(score(e) if e.type != "roster" else e)
        except sqlite3.IntegrityError:  # the same id arrived twice at once
            self.log.reject(e, "replay: duplicate id", fresh)
            raise Rejected("replay: duplicate id") from None
        if stored.type == "roster":
            self.roster.apply(stored.payload)
        return stored
