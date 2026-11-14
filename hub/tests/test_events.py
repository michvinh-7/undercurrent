import json
from pathlib import Path

from app.log import EventLog
from app.models import EventIn

EXAMPLES = Path(__file__).resolve().parents[2] / "shared" / "schemas" / "examples"


def make_log(tmp_path) -> EventLog:
    return EventLog(str(tmp_path / "test.db"), "hub-test")


def test_examples_fit_the_model():
    for path in EXAMPLES.glob("*.json"):
        data = json.loads(path.read_text())
        EventIn(**{k: data[k] for k in ("type", "level", "author", "payload", "priority")})


def test_append_and_list(tmp_path):
    log = make_log(tmp_path)
    log.append(EventIn(type="hazard", level=38, author="anon-1", payload={"kind": "flooding", "severity": "high"}))
    log.append(EventIn(type="checkin", level=31, author="anon-2", payload={"status": "ok"}))
    assert log.count() == 2
    assert [e.type for e in log.list(type="hazard")] == ["hazard"]
    assert [e.level for e in log.list(level=31)] == [31]


def test_chain_links_and_verifies(tmp_path):
    log = make_log(tmp_path)
    first = log.append(EventIn(type="checkin", level=10, author="a", payload={"status": "ok"}))
    second = log.append(EventIn(type="checkin", level=11, author="b", payload={"status": "ok"}))
    assert second.prev_hash == first.hash
    assert log.verify() == (True, None)


def test_tampering_is_detected(tmp_path):
    log = make_log(tmp_path)
    first = log.append(EventIn(type="case", level=38, author="a", payload={"symptoms": ["cough"]}))
    log.append(EventIn(type="case", level=38, author="b", payload={"symptoms": ["fever"]}))
    log._db.execute("UPDATE events SET payload = ? WHERE id = ?", (json.dumps({"symptoms": []}), first.id))
    log._db.commit()
    assert log.verify() == (False, first.id)
