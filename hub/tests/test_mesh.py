"""eval/run_mesh.py on a small mesh: a line of hubs, cut in the middle while both sides post,
then reconnected. Nothing lost or duplicated in either sync mode, and the summary asks less."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "eval"))

import run_mesh  # noqa: E402


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("TRIAGE_ON_INGEST", "0")


def test_a_small_line_of_hubs_survives_a_cut_in_both_modes(tmp_path):
    args = run_mesh.main.__globals__["argparse"].Namespace(
        hubs=8, history=3, cut_rounds=6, per_round=3, quiet=2, seed=7)
    runs = {mode: run_mesh.scenario(mode, args, tmp_path) for mode in ("ids", "summary")}
    for r in runs.values():
        assert r["lost"] == 0 and r["duplicated"] == 0 and r["chains_intact"] and r["refused"] == 0
        assert r["sides_agree_during_cut"] and r["deep_only_alerts_held_back"] > 0
        assert r["rounds_to_agree_history"] <= 8  # one hop a round across 7 links, plus one
    assert runs["summary"]["rounds_to_agree_after_reconnect"] == runs["ids"]["rounds_to_agree_after_reconnect"]
    quiet = {m: r["bytes"]["quiet_per_round"]["question"] for m, r in runs.items()}
    assert quiet["summary"] * 5 < quiet["ids"]
