import importlib

import pytest
from fastapi.testclient import TestClient

from app.ingest import message_text, score
from app.models import EventIn


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")  # nothing listens: keyword fallback, fast
    monkeypatch.delenv("CLOUD_PROVIDER", raising=False)
    import app.main
    return TestClient(importlib.reload(app.main).app)


def test_posted_report_comes_back_with_a_priority(client):
    r = client.post("/events", json={"type": "checkin", "level": 31, "author": "a", "payload": {"status": "need_help", "note": "trapped, water rising"}})
    assert r.status_code == 201
    assert r.json()["priority"] >= 0.9  # "trapped" -> SOS band


def test_routine_checkin_scores_low(client):
    r = client.post("/events", json={"type": "checkin", "level": 12, "author": "a", "payload": {"status": "ok"}})
    assert r.json()["priority"] < 0.5


def test_existing_priority_is_kept(client):
    r = client.post("/events", json={"type": "checkin", "level": 1, "author": "a", "payload": {"status": "ok"}, "priority": 0.42})
    assert r.json()["priority"] == 0.42


def test_ai_endpoints_are_mounted(client):
    assert client.post("/triage", json={"text": "sos level 38 trapped"}).json()["urgency"] == "sos"
    assert "disclaimer" in client.post("/organize", json={"payload": {"symptoms": ["fever"]}}).json()


def test_chain_still_verifies_after_scoring(client):
    client.post("/events", json={"type": "hazard", "level": 38, "author": "a", "payload": {"kind": "flooding", "severity": "high"}})
    assert client.get("/events/verify").json()["chain_intact"]


def test_message_text_from_phone_payloads():
    e = EventIn(type="hazard", level=38, author="a", payload={"kind": "bad_air", "severity": "high", "location": "east dorms"})
    assert message_text(e) == "Level 38. Hazard: bad air, severity high. At east dorms."


def test_switch_off(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")
    e = EventIn(type="checkin", level=1, author="a", payload={"status": "ok"})
    assert score(e).priority is None
