"""Append-only, hash-chained event log on SQLite.

Each event's hash covers its content plus the previous event's hash, so editing or
deleting an earlier event breaks the chain. There is one chain per origin hub
(`hub_id`): this hub's own events chain in the order it stored them, and events
synced from another hub keep the prev_hash/hash their origin gave them.

Synced events can arrive out of chain order (the link sends highest priority first),
so verify() checks each event's own hash and signature on its own, and the links
between events per origin: a missing link in this hub's own chain means a deleted
row; in another hub's chain it's a gap, an event still in transit.

The hub also keeps the hash of every event it wrote itself (own_hashes). That
list is how it knows its own chain's tip even if the newest row is deleted, and how
it can take a deleted row back from a peer: only a row whose hash it wrote.
"""

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from . import crypto
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
CREATE INDEX IF NOT EXISTS idx_events_hub ON events(hub_id);
CREATE TABLE IF NOT EXISTS own_hashes (
    n        INTEGER PRIMARY KEY AUTOINCREMENT,
    hash     TEXT UNIQUE NOT NULL,
    event_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rejected (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    reason      TEXT NOT NULL,
    via         TEXT NOT NULL,
    event       TEXT NOT NULL,
    event_id    TEXT
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
        if "event_id" not in {r["name"] for r in self._db.execute("PRAGMA table_info(rejected)")}:
            self._db.execute("ALTER TABLE rejected ADD COLUMN event_id TEXT")
        if self._db.execute("SELECT COUNT(*) FROM own_hashes").fetchone()[0] == 0:
            # A hub.db from before own_hashes: its own events were stored in chain order.
            self._db.execute(
                "INSERT OR IGNORE INTO own_hashes (hash, event_id) SELECT hash, id FROM events WHERE hub_id = ? ORDER BY seq",
                (hub_id,),
            )
        self._db.commit()

    def _last_hash(self, hub_id: str) -> str:
        """The tip of `hub_id`'s chain. For this hub: the last hash it wrote, even if that
        row has since been deleted (so the deletion shows in verify) or a restored row was
        stored after it."""
        if hub_id == self.hub_id:
            row = self._db.execute("SELECT hash FROM own_hashes ORDER BY n DESC LIMIT 1").fetchone()
            if row:
                return row["hash"]
        row = self._db.execute(
            "SELECT hash FROM events WHERE hub_id = ? ORDER BY seq DESC LIMIT 1", (hub_id,)
        ).fetchone()
        return row["hash"] if row else GENESIS

    def _insert(self, event: Event, own: bool = False) -> None:
        row = event.model_dump()
        row["payload"] = json.dumps(row["payload"])
        try:
            self._db.execute(
                f"INSERT INTO events ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' * len(_COLUMNS))})",
                [row[c] for c in _COLUMNS],
            )
            if own:
                self._db.execute("INSERT OR IGNORE INTO own_hashes (hash, event_id) VALUES (?, ?)", (event.hash, event.id))
        except sqlite3.IntegrityError:
            self._db.rollback()
            raise
        self._db.commit()

    def wrote(self, event_hash: str) -> bool:
        """Did this hub write an event with this hash itself?"""
        return self._db.execute("SELECT 1 FROM own_hashes WHERE hash = ?", (event_hash,)).fetchone() is not None

    def append(self, event_in: EventIn) -> Event:
        """Store an event. A signed event keeps the id, created_at and hub_id its signer set
        (they're under the signature); the hub mints them only when the client left them out."""
        with self._lock:
            fields = event_in.model_dump()
            fields["id"] = fields["id"] or str(uuid.uuid4())
            fields["created_at"] = fields["created_at"] or now_iso()
            fields["hub_id"] = fields["hub_id"] or self.hub_id
            fields["prev_hash"] = self._last_hash(fields["hub_id"])
            fields["hash"] = compute_hash(fields, fields["prev_hash"])
            event = Event(**fields)
            self._insert(event, own=event.hub_id == self.hub_id)
            return event

    def insert_synced(self, event: Event) -> Event:
        """Store an event from another hub exactly as it came: its own prev_hash and hash,
        which chain it into its origin hub's chain. A duplicate id raises sqlite3.IntegrityError."""
        with self._lock:
            self._insert(event)
            return event

    def get(self, event_id: str) -> Event | None:
        row = self._db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return self._readable(row) if row else None

    def ids(self) -> list[str]:
        return [r[0] for r in self._db.execute("SELECT id FROM events ORDER BY seq")]

    def reject(self, event_in: EventIn, reason: str, fresh: bool = True) -> bool:
        """Keep a record of an event that failed the checks (feeds GET /rejected and the counter).
        Over sync, each event is recorded once: a peer that keeps offering it isn't a new
        forgery each time. Returns whether it was recorded."""
        with self._lock:
            if not fresh and event_in.id and self._db.execute(
                "SELECT 1 FROM rejected WHERE via = 'sync' AND event_id = ?", (event_in.id,)
            ).fetchone():
                return False
            self._db.execute(
                "INSERT INTO rejected (received_at, reason, via, event, event_id) VALUES (?, ?, ?, ?, ?)",
                (now_iso(), reason, "post" if fresh else "sync", event_in.model_dump_json(), event_in.id),
            )
            self._db.commit()
            return True

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
        return [e for r in rows if (e := self._readable(r)) is not None]

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
        return [(row["seq"], e) for row in rows if (e := self._readable(row)) is not None]

    def fingerprint(self) -> str:
        """One short hash of every event this hub holds, in any order: two hubs that hold
        exactly the same events show the same fingerprint, whatever order they got them in."""
        hashes = sorted(r[0] for r in self._db.execute("SELECT hash FROM events"))
        blob = f"{len(hashes)}:" + ",".join(hashes)
        return hashlib.sha256(blob.encode()).hexdigest()[:12]

    def count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    def verify(self) -> tuple[bool, str | None]:
        """(intact, id of the first bad event or None). See verify_report()."""
        report = self.verify_report()
        return report["chain_intact"], report["first_bad_event"]

    def verify_report(self) -> dict:
        """Check every event and every origin hub's chain.

        Bad (in storage order, the first one is reported):
        - an event whose hash doesn't match its content, or whose signature doesn't verify
        - two events of one origin claiming the same predecessor (a fork)
        - an event of THIS hub whose predecessor is missing (a deleted row)
        - an event this hub wrote that is no longer stored (a deleted row, newest included);
          reported only if nothing above was found, since a later row already points at it
        Not bad: another hub's event whose predecessor hasn't arrived yet. Counted in `gaps`.
        """
        rows = self._db.execute("SELECT * FROM events ORDER BY seq").fetchall()
        hashes: dict[str, set[str]] = {}
        for r in rows:
            hashes.setdefault(r["hub_id"], set()).add(r["hash"])
        seen_prev: set[tuple[str, str]] = set()
        gaps: dict[str, int] = {}
        first_bad = None
        for r in rows:
            e = self._readable(r)
            if e is None:  # edited into something that isn't an event (a level of 999999, a broken payload)
                bad = True
            else:
                fields = e.model_dump()
                bad = compute_hash(fields, e.prev_hash) != e.hash or (e.sig is not None and not crypto.verify(fields))
            if (r["hub_id"], r["prev_hash"]) in seen_prev:
                bad = True  # fork: a second event claims the same predecessor
            seen_prev.add((r["hub_id"], r["prev_hash"]))
            if r["prev_hash"] != GENESIS and r["prev_hash"] not in hashes[r["hub_id"]]:
                if r["hub_id"] == self.hub_id:
                    bad = True  # a row of our own chain is missing
                else:
                    gaps[r["hub_id"]] = gaps.get(r["hub_id"], 0) + 1
            if bad and first_bad is None:
                first_bad = r["id"]
        if first_bad is None:
            missing = self._db.execute(
                "SELECT event_id FROM own_hashes WHERE event_id NOT IN (SELECT id FROM events) ORDER BY n LIMIT 1"
            ).fetchone()
            first_bad = missing["event_id"] if missing else None
        return {"chain_intact": first_bad is None, "first_bad_event": first_bad, "gaps": gaps}

    @classmethod
    def _readable(cls, row: sqlite3.Row) -> Event | None:
        """The row as an Event, or None if someone edited it into something that isn't one.
        Such a row is skipped when listing (so one bad row can't take the hub's pages down)
        and named as bad by verify_report()."""
        try:
            return cls._row_to_event(row)
        except (ValueError, TypeError):  # pydantic's ValidationError and JSONDecodeError are ValueErrors
            return None

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Event:
        data = dict(row)
        data.pop("seq")
        data["payload"] = json.loads(data["payload"])
        return Event(**data)
