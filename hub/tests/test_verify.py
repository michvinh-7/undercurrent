"""scripts/verify.py, the independent audit: a log built by the real hub passes, and every
kind of tampering is caught without the verifier using any hub code."""

import ast
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HUB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HUB / "scripts"))

import verify  # noqa: E402
from app import crypto  # noqa: E402
from app.gate import Gate  # noqa: E402
from app.log import EventLog  # noqa: E402
from app.models import EventIn  # noqa: E402
from app.roster import Roster  # noqa: E402

ID = "hub-L34"
T0 = datetime(2087, 3, 14, 2, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


def iso(t):
    return t.isoformat().replace("+00:00", "Z")


def signed(key, t, type="hazard", payload=None):
    return crypto.sign({
        "id": str(uuid.uuid4()), "type": type, "hub_id": ID, "level": 34, "created_at": iso(t),
        "author": "canary-34", "payload": payload or {"kind": "flooding", "severity": "high", "note": "eau qui monte"},
        "source": "sensor", "device_id": "canary-34",
    }, key)


@pytest.fixture
def hub(tmp_path):
    """A real hub log: 5 signed alerts, then a new member added by the operator, who posts."""
    op, member, newcomer = crypto.new_key(), crypto.new_key(), crypto.new_key()
    roster = [{"pub": crypto.public_key(op), "role": "operator"}, {"pub": crypto.public_key(member), "role": "member"}]
    path = tmp_path / "hub.db"
    gate = Gate(EventLog(str(path), ID), Roster(roster), ID, require_signed=True, window_s=10**9)
    for i in range(5):
        gate.admit(EventIn(**signed(member, T0 + timedelta(minutes=i))), now=T0)
    gate.admit(EventIn(**signed(op, T0 + timedelta(minutes=6), type="roster",
                                payload={"action": "add", "pub": crypto.public_key(newcomer), "role": "member"})), now=T0)
    gate.admit(EventIn(**signed(newcomer, T0 + timedelta(minutes=7))), now=T0)
    return {"path": str(path), "roster": roster, "keys": (op, member, newcomer), "log": gate.log}


def run(hub, roster=True):
    return verify.audit(verify.from_db(hub["path"]), hub["roster"] if roster else None)


def checks(report):
    return {p["check"] for p in report["problems"]}


def sql(hub, query, *params):
    db = sqlite3.connect(hub["path"])
    db.execute(query, params)
    db.commit()
    db.close()


def test_imports_nothing_from_the_hub():
    tree = ast.parse((HUB / "scripts" / "verify.py").read_text())
    modules = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    modules |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    assert not any(m and (m == "app" or m.startswith("app.")) for m in modules)


def test_restated_rules_match_the_hubs():
    from app.log import GENESIS, compute_hash
    from app.models import SIGNED_FIELDS
    assert verify.SIGNED_FIELDS == SIGNED_FIELDS and verify.GENESIS == GENESIS
    e = signed(crypto.new_key(), T0) | {"prev_hash": GENESIS}
    assert verify.event_hash(e) == compute_hash(e, GENESIS)
    assert verify.signed_bytes(e) == crypto.canonical_bytes(e)


def test_an_untouched_hub_passes_and_fingerprints_match(hub):
    r = run(hub)
    assert r["passed"], r["problems"]
    assert (r["events"], r["signed"], r["own_hub"]) == (7, 7, ID)
    assert r["fingerprint"] == hub["log"].fingerprint()


def test_an_edited_payload_is_caught_at_its_row(hub):
    target = hub["log"].list()[2].id
    sql(hub, "UPDATE events SET payload = ? WHERE id = ?", json.dumps({"kind": "flooding", "severity": "low"}), target)
    r = run(hub)
    assert not r["passed"]
    assert {p["event"] for p in r["problems"] if p["check"] == "hash"} == {target}


def test_a_re_hashed_edit_still_fails_the_signature(hub):
    """An attacker who also recomputes the hash still can't forge the signer's signature."""
    e = hub["log"].list()[1].model_dump()
    e["payload"] = {"kind": "flooding", "severity": "low"}
    sql(hub, "UPDATE events SET payload = ?, hash = ? WHERE id = ?", json.dumps(e["payload"]), verify.event_hash(e), e["id"])
    assert "signature" in checks(run(hub))


def test_a_deleted_middle_row_and_a_deleted_newest_row_are_both_caught(hub):
    events = hub["log"].list()
    sql(hub, "DELETE FROM events WHERE id = ?", events[2].id)
    assert "missing row" in checks(run(hub))
    sql(hub, "DELETE FROM events WHERE id = ?", events[-1].id)  # the newest: no later row points at it
    missing = {p["event"] for p in run(hub)["problems"] if p["check"] == "missing row"}
    assert events[-1].id in missing


def test_a_signer_not_on_the_auditors_roster_is_caught(hub):
    stranger = crypto.new_key()
    hub["log"].append(EventIn(**signed(stranger, T0 + timedelta(minutes=9))))
    assert checks(run(hub)) == {"signer"}
    assert run(hub, roster=False)["passed"]  # without a roster it can't know, and says so


def test_a_roster_change_by_a_non_operator_is_ignored(hub):
    _, member, _ = hub["keys"]
    stranger = crypto.new_key()
    hub["log"].append(EventIn(**signed(member, T0 + timedelta(minutes=10), type="roster",
                                       payload={"action": "add", "pub": crypto.public_key(stranger), "role": "member"})))
    hub["log"].append(EventIn(**signed(stranger, T0 + timedelta(minutes=11))))
    assert checks(run(hub)) == {"roster", "signer"}


def test_a_member_removed_later_keeps_their_earlier_alerts(hub):
    op, member, _ = hub["keys"]
    hub["log"].append(EventIn(**signed(op, T0 + timedelta(minutes=20), type="roster",
                                       payload={"action": "remove", "pub": crypto.public_key(member)})))
    assert run(hub)["passed"]
    hub["log"].append(EventIn(**signed(member, T0 + timedelta(minutes=21))))
    assert checks(run(hub)) == {"signer"}


def test_two_versions_of_one_event_fail_the_cross_check(hub, tmp_path):
    a = verify.from_db(hub["path"])
    b = json.loads(json.dumps(a))
    b["name"] = "other"
    b["events"][0]["hash"] = "f" * 64
    b["events"].pop()
    c = verify.cross_check(a, b)
    assert c["conflicts"] == [a["events"][0]["id"]] and len(c["only_in_a"]) == 1 and not c["passed"]


def test_save_then_audit_the_export_and_sign_the_report(hub, tmp_path, capsys):
    import roster_tool
    export, report, key = tmp_path / "export.json", tmp_path / "report.json", tmp_path / "auditor.key"
    roster_file = tmp_path / "roster.json"
    roster_file.write_text(json.dumps(hub["roster"]))
    roster_tool.write_key(key)
    assert verify.main(["--db", hub["path"], "--roster", str(roster_file), "--save", str(export)]) == 0
    assert verify.main(["--file", str(export), "--roster", str(roster_file),
                        "--json", str(report), "--sign-key", str(key)]) == 0
    assert verify.main(["--check-report", str(report)]) == 0
    doctored = json.loads(report.read_text())
    doctored["passed"] = False
    report.write_text(json.dumps(doctored))
    assert verify.main(["--check-report", str(report)]) == 1
    assert "INVALID" in capsys.readouterr().out
