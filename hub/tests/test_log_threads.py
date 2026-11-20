"""The event log under the hub's real load: request threads and the sync thread share one
SQLite connection. Every event a hub said it stored must be on disk when it restarts.
(Unlocked reads racing writes once made a commit fail; the hub kept serving 76 events
from an open transaction, and a restart lost all of them.)"""

import threading
import uuid

from app import crypto
from app.log import EventLog
from app.models import EventIn


def test_events_survive_a_restart_under_concurrent_reads_and_writes(tmp_path):
    path = str(tmp_path / "hub.db")
    log = EventLog(path, "hub-L34")
    key = crypto.new_key()
    stored, errors = [], []
    stop = threading.Event()

    def write(n):
        for i in range(n):
            e = crypto.sign({"id": str(uuid.uuid4()), "type": "hazard", "hub_id": "hub-L34", "level": 34,
                             "created_at": "2087-03-14T02:00:00Z", "author": "canary-34", "source": "sensor",
                             "payload": {"kind": "flooding", "severity": "high", "i": i}}, key)
            try:
                stored.append(log.append(EventIn(**e)).id)
            except Exception as err:  # noqa: BLE001
                errors.append(repr(err))

    def read():
        while not stop.is_set():
            try:
                log.fingerprint(), log.ids(), log.count(), log.summary(), log.rejected(1), log.verify_report()
            except Exception as err:  # noqa: BLE001
                errors.append(repr(err))

    readers = [threading.Thread(target=read) for _ in range(4)]
    writers = [threading.Thread(target=write, args=(60,)) for _ in range(3)]
    for t in readers + writers:
        t.start()
    for t in writers:
        t.join()
    stop.set()
    for t in readers:
        t.join()

    assert errors == []
    assert len(stored) == 180
    log._db.close()  # the hub stops; what's on disk is what's left
    again = EventLog(path, "hub-L34")
    assert set(again.ids()) == set(stored)
    assert again.verify_report()["chain_intact"]
