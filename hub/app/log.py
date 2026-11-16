"""Append-only, hash-chained event log on SQLite.

Starter version for Person 1 to own and extend (sync, link simulation).
Each event's hash covers its content plus the previous event's hash,
so editing or deleting any earlier event breaks the chain.
"""

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from .models import Event, EventIn

GENESIS = "0" * 64

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT UNIQUE NOT NULL,
    type       TEXT NOT NULL,
    hub_id     TEXT NOT NULL,
    level      INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    author     TEXT NOT NULL,
    priority   REAL,
    payload    TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
"""


def compute_hash(fields: dict, prev_hash: str) -> str:
    """SHA-256 over the event's content (stable key order) + prev_hash."""
    content = {k: fields[k] for k in ("id", "type", "hub_id", "level", "created_at", "author", "payload")}
    blob = json.dumps(content, sort_keys=True, separators=(",", ":")) + prev_hash
    return hashlib.sha256(blob.encode()).hexdigest()


class EventLog:
    def __init__(self, path: str, hub_id: str):
        self.hub_id = hub_id
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)

    def _last_hash(self) -> str:
        row = self._db.execute("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").fetchone()
        return row["hash"] if row else GENESIS

    def append(self, event_in: EventIn) -> Event:
        with self._lock:
            fields = {
                "id": str(uuid.uuid4()),
                "type": event_in.type,
                "hub_id": self.hub_id,
                "level": event_in.level,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "author": event_in.author,
                "payload": event_in.payload,
            }
            prev_hash = self._last_hash()
            event = Event(
                **fields,
                priority=event_in.priority,
                prev_hash=prev_hash,
                hash=compute_hash(fields, prev_hash),
            )
            self._db.execute(
                "INSERT INTO events (id, type, hub_id, level, created_at, author, priority, payload, prev_hash, hash)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event.id, event.type, event.hub_id, event.level, event.created_at, event.author,
                    event.priority, json.dumps(event.payload), event.prev_hash, event.hash,
                ),
            )
            self._db.commit()
            return event

    def list(self, type: str | None = None, level: int | None = None, since: str | None = None) -> list[Event]:
        query, params = "SELECT * FROM events WHERE 1=1", []
        if type:
            query += " AND type = ?"
            params.append(type)
        if level is not None:
            query += " AND level = ?"
            params.append(level)
        if since:
            query += " AND created_at > ?"
            params.append(since)
        rows = self._db.execute(query + " ORDER BY seq", params).fetchall()
        return [self._row_to_event(r) for r in rows]

    def after(self, seq: int, type: str | None = None, level: int | None = None) -> list[tuple[int, Event]]:
        """Events stored after position `seq`, with their positions. Used by the live stream:
        positions never repeat or skip, unlike timestamps (which only have 1-second precision)."""
        query, params = "SELECT * FROM events WHERE seq > ?", [seq]
        if type:
            query += " AND type = ?"
            params.append(type)
        if level is not None:
            query += " AND level = ?"
            params.append(level)
        with self._lock:
            rows = self._db.execute(query + " ORDER BY seq", params).fetchall()
        return [(row["seq"], self._row_to_event(row)) for row in rows]

    def count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    def verify(self) -> tuple[bool, str | None]:
        """Walk the chain. Returns (intact, id of the first bad event or None)."""
        prev = GENESIS
        for row in self._db.execute("SELECT * FROM events ORDER BY seq"):
            event = self._row_to_event(row)
            if event.prev_hash != prev or compute_hash(event.model_dump(), prev) != event.hash:
                return False, event.id
            prev = event.hash
        return True, None

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Event:
        data = dict(row)
        data.pop("seq")
        data["payload"] = json.loads(data["payload"])
        return Event(**data)
