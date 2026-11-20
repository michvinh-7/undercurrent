"""POST /link (cut the network, change its bandwidth) answers only the hub's own machine,
so the Directorate can't cut the residents' link through the hub's own API."""

import importlib

import pytest
from fastapi.testclient import TestClient


def hub(monkeypatch, tmp_path, open_control=False):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")
    monkeypatch.delenv("HUB_PEERS", raising=False)
    if open_control:
        monkeypatch.setenv("LINK_CONTROL", "open")
    else:
        monkeypatch.delenv("LINK_CONTROL", raising=False)
    import app.main
    return importlib.reload(app.main).app


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "testclient"])
def test_this_machine_can_cut_and_restore(monkeypatch, tmp_path, host):
    client = TestClient(hub(monkeypatch, tmp_path), client=(host, 50000))
    assert client.post("/link", json={"cut": True}).json()["cut"] is True
    assert client.post("/link", json={"cut": False}).json()["cut"] is False


def test_another_machine_on_the_wifi_is_refused_and_the_link_stays_up(monkeypatch, tmp_path):
    client = TestClient(hub(monkeypatch, tmp_path), client=("192.168.1.23", 50000))
    r = client.post("/link", json={"cut": True})
    assert r.status_code == 403 and "own machine" in r.json()["detail"]
    assert client.get("/link").json()["cut"] is False  # reading the link stays open to all


def test_a_browser_on_the_laptop_using_its_wifi_address_counts_as_this_machine(monkeypatch, tmp_path):
    app = hub(monkeypatch, tmp_path)
    client = TestClient(app, base_url="http://192.168.1.5:8002", client=("192.168.1.5", 50000))
    # TestClient reports the server as the base_url's host, as uvicorn reports the address reached
    assert client.post("/link", json={"cut": True}).status_code == 200


def test_link_control_open_lets_other_machines_in(monkeypatch, tmp_path):
    client = TestClient(hub(monkeypatch, tmp_path, open_control=True), client=("192.168.1.23", 50000))
    assert client.post("/link", json={"cut": True}).status_code == 200
