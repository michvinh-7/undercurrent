"""The Livability Index (app/livability.py): plain rules, signed events only, no free 100s."""

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from app.livability import livability, sensor_score

ROOT = Path(__file__).resolve().parents[2]
T0 = datetime(2087, 3, 14, 2, 0, tzinfo=timezone.utc)
NOW = (T0 + timedelta(hours=1)).timestamp()


def ev(level, type="hazard", minutes=50, sensor=False, signed=True, who=None, **payload):
    return SimpleNamespace(
        id=str(uuid.uuid4()), type=type, level=level, hub_id="hub-L34", priority=None,
        created_at=(T0 + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z"),
        author=who or "anon", author_pub=who or "k", sig="s" if signed else None,
        source="sensor" if sensor else "resident", device_id=f"canary-{level}" if sensor else None,
        payload=payload,
    )


def by_level(r):
    return {x["level"]: x for x in r["levels"]}


def reading(value, unit):
    return {"reading": {"value": value, "unit": unit}}


def test_sensor_rules():
    assert sensor_score(reading(0, "cm"))[:2] == ("flooding", 100)
    assert sensor_score(reading(20, "cm"))[:2] == ("flooding", 0)
    assert sensor_score(reading(1000, "ppm CO₂"))[:2] == ("air", 100)
    assert sensor_score(reading(1750, "ppm CO₂"))[:2] == ("air", 50)
    assert sensor_score(reading(40, "°C"))[:2] == ("heat", 0)
    assert sensor_score(reading(200, "V"))[:2] == ("power", 50)
    assert sensor_score({"oxygen_pct": 18})[:2] == ("air", 33)
    assert sensor_score(reading(5, "lux")) is None


def test_no_data_is_no_score_not_a_free_100():
    lv = by_level(livability([ev(34, kind="bad_water", severity="medium")], now=NOW))[34]
    assert lv["coverage"] == 1 and list(lv["dimensions"]) == ["water"] and lv["score"] == 50


def test_the_worse_of_sensor_and_report_counts():
    r = livability([
        ev(35, sensor=True, minutes=55, kind="flooding", severity="low", **reading(1, "cm")),  # probe: nearly dry
        ev(35, minutes=50, kind="flooding", severity="high"),  # a resident standing in water
    ], now=NOW)
    d = by_level(r)[35]["dimensions"]["flooding"]
    assert d["score"] == 20 and d["from"] == ["report", "sensor"] and len(d["events"]) == 2


def test_newest_reading_replaces_older_ones():
    r = livability([
        ev(34, sensor=True, minutes=10, kind="bad_air", severity="high", **reading(2400, "ppm CO₂")),
        ev(34, sensor=True, minutes=50, kind="bad_air", severity="low", **reading(900, "ppm CO₂")),  # fan fixed
    ], now=NOW)
    assert by_level(r)[34]["dimensions"]["air"]["score"] == 100


def test_one_unsafe_dimension_caps_the_level_at_unsafe():
    events = [ev(34, sensor=True, kind="bad_air", severity="high", **reading(2500, "ppm CO₂"))]
    events += [ev(34, sensor=True, kind="heat", severity="low", **reading(20, "\u00b0C")),
               ev(34, sensor=True, kind="flooding", severity="low", **reading(0, "cm"))]
    events += [ev(34, type="checkin", who=w, status="ok", sleep_h=8, mood=5) for w in ("a", "b", "c")]
    lv = by_level(livability(events, now=NOW))[34]  # the mean alone would be 69: "strained"
    assert lv["dimensions"]["people"]["score"] == 100 and lv["dimensions"]["air"]["score"] == 0
    assert (lv["score"], lv["band"], lv["capped"], lv["limited_by"]) == (49, "unsafe", True, "air")


def test_unsigned_and_old_events_dont_count():
    r = livability([
        ev(34, signed=False, kind="flooding", severity="high"),
        ev(34, minutes=-400, kind="flooding", severity="high"),  # 7 h before now: outside the 6 h window
    ], now=NOW)
    assert r["levels"] == [] and r["ignored_unsigned"] == 1


def test_health_needs_and_people():
    events = [
        ev(34, type="case", people_affected=3, symptoms=["cough"]),
        ev(34, type="exchange", side="need", category="medicine", item="inhaler", who="a"),
        ev(34, type="checkin", who="b", status="ok", sleep_h=4, mood=1),
        ev(34, type="checkin", who="c", status="ok", sleep_h=6, mood=3),
    ]
    d = by_level(livability(events, now=NOW))[34]["dimensions"]
    assert d["health"]["score"] == 76 and d["health"]["why"] == "3 people sick in 1 report"
    assert d["needs"]["score"] == 85 and d["needs"]["why"] == "1 unmet request"
    assert d["people"]["score"] == 25  # sleep 5 h -> 25, mood 2 -> 25


def test_the_sim_scenario_ranks_levels_like_the_ground_truth():
    """Built from sim/world.json in memory. The hidden truth: L34 is worst (water and lungs),
    then L35 (the flood), then L12 (the relay), and the surface is fine."""
    sys.path.insert(0, str(ROOT / "sim"))
    import simulate
    world = simulate.load_world(ROOT / "sim" / "world.json")
    events = []
    for step in world["timeline"]:
        e = simulate.make_event(world, step, (T0 + timedelta(seconds=step["t"] * 20)).isoformat().replace("+00:00", "Z"))
        events.append(SimpleNamespace(**{"sig": "s", "author_pub": step["by"], "source": None, "device_id": None,
                                          "priority": None, **e}))
    r = livability(events, now=(T0 + timedelta(seconds=4000)).timestamp())
    assert [x["level"] for x in r["levels"]] == [34, 35, 12, 1]
    lv = by_level(r)
    assert lv[34]["band"] == "unsafe" and lv[34]["limited_by"] == "air"
    assert lv[35]["dimensions"]["flooding"]["score"] < 25
    assert "forecast" in lv[12]["dimensions"]["power"]["from"]
    assert lv[1]["band"] == "livable"
    ids = {e.id for e in events}
    assert all(i in ids for x in r["levels"] for d in x["dimensions"].values() for i in d["events"])


def test_food_is_the_median_days_at_home_and_unmet_food_requests_pull_it_down():
    """Question 12: each person's latest answer counts once; 7+ days is 100."""
    events = [ev(34, type="checkin", who=w, status="ok", food_days=d) for w, d in (("a", 1), ("b", 2), ("c", 5))]
    events.append(ev(34, type="checkin", who="a", minutes=55, status="ok", food_days=0))  # a's newer answer replaces the old one
    lv = by_level(livability(events, now=NOW))[34]
    food = lv["dimensions"]["food"]
    assert food["score"] == 29 and "2 days of food at home, median of 3 people" in food["why"]  # median of 0, 2, 5
    events.append(ev(34, type="exchange", side="need", category="food", item="rice", minutes=40))
    food = by_level(livability(events, now=NOW))[34]["dimensions"]["food"]
    assert food["score"] == 4 and "1 unmet food request" in food["why"] and "exchange" in food["from"]


def test_one_household_alone_doesnt_show_and_food_needs_dont_count_twice():
    one = [ev(12, type="checkin", who="a", status="ok", food_days=0)]
    assert 12 not in by_level(livability(one, now=NOW))  # fewer than 2 people: no food score
    need = [ev(12, type="exchange", side="need", category="food", item="flour", minutes=40)]
    lv = by_level(livability(need, now=NOW))[12]
    assert lv["dimensions"]["food"]["score"] == 75 and "needs" not in lv["dimensions"]
