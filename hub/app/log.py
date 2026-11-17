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

from .models import SIGNED_FIELDS, Event, EventIn

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
    hash       TEXT NOT NULL,
    author_pub TEXT,
    sig        TEXT,
    source     TEXT,
    device_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
CREATE TABLE IF NOT EXISTS rejected (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    reason      TEXT NOT NULL,
    via         TEXT NOT NULL,
    event       TEXT NOT NULL
);
"""

# Columns added for signing; added to older hub.db files on open.
_SIGNING_COLUMNS = ("author_pub", "sig", "source", "device_id")
_COLUMNS = (
    "id", "type", "hub_id", "level", "created_at", "author", "priority", "payload",
    "prev_hash", "hash", *_SIGNING_COLUMNS,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def compute_hash(fields: dict, prev_hash: str) -> str:
    """SHA-256 over the event's content (stable key order) + prev_hash.

    Covers SIGNED_FIELDS plus sig, leaving out null ones, so events stored before
    signing existed hash exactly as they always did. priority is outside on purpose."""
    content = {k: fields[k] for k in (*SIGNED_FIELDS, "sig") if fields.get(k) is not None}
    blob = json.dumps(content, sort_keys=True, separators=(",", ":")) + prev_hash
    return hashlib.sha256(blob.encode()).hexdigest()


class EventLog:
    def __init__(self, path: str, hub_id: str):
        self.hub_id = hub_id
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        have = {r["name"] for r in self._db.execute("PRAGMA table_info(events)")}
        for col in _SIGNING_COLUMNS:
            if col not in have:
                self._db.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
        self._db.commit()

    def _last_hash(self) -> str:
        row = self._db.execute("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").fetchone()
        return row["hash"] if row else GENESIS

    def append(self, event_in: EventIn) -> Event:
        """Store an event. A signed event keeps the id, created_at and hub_id its signer set
        (they're under the signature); the hub mints them only when the client left them out."""
        with self._lock:
            fields = event_in.model_dump()
            fields["id"] = fields["id"] or str(uuid.uuid4())
            fields["created_at"] = fields["created_at"] or now_iso()
            fields["hub_id"] = fields["hub_id"] or self.hub_id
            fields["prev_hash"] = self._last_hash()
            fields["hash"] = compute_hash(fields, fields["prev_hash"])
            event = Event(**fields)
            row = event.model_dump()
            row["payload"] = json.dumps(row["payload"])
            self._db.execute(
                f"INSERT INTO events ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' * len(_COLUMNS))})",
                [row[c] for c in _COLUMNS],
            )
            self._db.commit()
            return event

    def reject(self, event_in: EventIn, reason: str, fresh: bool = True) -> None:
        """Keep a record of an event that failed the checks (feeds GET /rejected and the counter)."""
        with self._lock:
            self._db.execute(
                "INSERT INTO rejected (received_at, reason, via, event) VALUES (?, ?, ?, ?)",
                (now_iso(), reason, "post" if fresh else "sync", event_in.model_dump_json()),
            )
            self._db.commit()

    def rejected(self, limit: int = 100) -> tuple[int, list[dict]]:
        """(total count, newest `limit` rejections)."""
        total = self._db.execute("SELECT COUNT(*) FROM rejected").fetchone()[0]
        rows = self._db.execute("SELECT * FROM rejected ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return total, [{**dict(r), "event": json.loads(r["event"])} for r in rows]

    def has(self, event_id: str) -> bool:
        return self._db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is not None

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
