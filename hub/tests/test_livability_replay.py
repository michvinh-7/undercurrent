"""scripts/livability_replay.py: the simulated night the web app plays back is scored by the
hub's real livability code, and the saved frames still match it."""

import json
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HUB / "scripts"))

import livability_replay as replay  # noqa: E402
from app import crypto  # noqa: E402


def test_saved_frames_match_the_scoring_code():
    """Fails after a change to app/livability.py until the frames are regenerated."""
    assert replay.main(["--check"]) == 0


def test_the_night_is_reproducible_and_every_event_is_signed():
    a, b = replay.build(), replay.build()
    assert [e.id for e in a.events] == [e.id for e in b.events]
    assert all(crypto.verify(e.model_dump()) for e in a.events)
    assert all(e.payload["simulated"] is True for e in a.events)


def test_the_story_the_playback_tells():
    frames = {f["t"]: f["levels"] for f in json.loads(replay.render())["frames"]}
    at = lambda hhmm, level: frames[(int(hhmm[:2]) - 2) * 60 + int(hhmm[3:])][str(level)]
    assert all(at("02:00", lv)["band"] == "livable" for lv in replay.LEVELS)
    assert at("04:30", 34)["band"] == "unsafe" and at("04:30", 34)["by"] == "air"
    assert at("04:30", 35)["band"] == "unsafe" and at("04:30", 35)["by"] == "flooding"
    assert at("04:00", 12)["band"] == "unsafe" and at("04:00", 12)["by"] == "water"
    assert at("05:10", 34)["dims"]["power"] <= 40  # the blackout forecast caps power
    assert at("06:00", 12)["band"] == "livable"  # recycler fixed
    assert at("07:00", 34)["band"] != "unsafe"  # fan fixed
    assert all(f["1"]["band"] == "livable" for f in frames.values())
    assert at("08:00", 35)["band"] == "unsafe" and at("08:00", 35)["by"] == "food"  # the flood spoiled the stores
