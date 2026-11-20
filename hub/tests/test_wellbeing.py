"""Sleep, mood and the roll call (app/wellbeing.py)."""

from types import SimpleNamespace

from app.wellbeing import wellbeing

NOW = 1_800_003_600  # 2027-01-15 09:00 UTC


def ev(who, level, hours_ago, type="checkin", source=None, **payload):
    t = NOW - hours_ago * 3600
    from datetime import datetime, timezone
    return SimpleNamespace(
        type=type, level=level, source=source, author=f"anon-{who}", author_pub=who,
        created_at=datetime.fromtimestamp(t, timezone.utc).isoformat(), payload={"status": "ok", **payload},
    )


def level(r, n):
    return next(x for x in r["levels"] if x["level"] == n)


def test_averages_per_level_from_each_persons_latest_answer():
    r = wellbeing([
        ev("a", 34, 3, sleep_h=8, mood=4),  # a's older answer: replaced by the newer one
        ev("a", 34, 1, sleep_h=4, mood=2),
        ev("b", 34, 2, sleep_h=5, mood=1),
        ev("c", 12, 2, sleep_h=7, mood=4),
        ev("d", 12, 2, sleep_h=8, mood=5),
    ], now=NOW)
    deep, upper = level(r, 34), level(r, 12)
    assert deep == {"level": 34, "people": 2, "sleep_avg_h": 4.5, "short_sleep_share": 1.0, "mood_avg": 1.5, "low_mood_share": 1.0}
    assert upper["sleep_avg_h"] == 7.5 and upper["mood_avg"] == 4.5 and upper["low_mood_share"] == 0.0


def test_one_persons_answer_is_never_shown_on_its_own():
    r = wellbeing([ev("a", 35, 1, sleep_h=3, mood=1)], now=NOW)
    assert level(r, 35) == {"level": 35, "people": 1, "hidden": "fewer than 2 people answered"}


def test_old_answers_bad_values_and_sensors_are_left_out():
    r = wellbeing([
        ev("a", 34, 30, sleep_h=2, mood=1),  # yesterday: outside the 24 h window
        ev("b", 34, 1, sleep_h=99, mood=7),  # out of range: not an answer
        ev("c", 34, 1, sleep_h="5", mood=True),  # wrong types (a string, a bool): not answers
        ev("box", 34, 1, type="hazard", source="sensor", sleep_h=5, mood=2),
    ], now=NOW)
    assert r["levels"] == []


def test_roll_call_lists_people_heard_this_week_but_not_today():
    r = wellbeing([
        ev("a", 34, 1, sleep_h=6),
        ev("b", 35, 50, type="case"),  # last heard two days ago
        ev("c", 12, 26),  # yesterday
        ev("old", 12, 24 * 9),  # over a week: not on the list
        ev("box", 34, 40, type="hazard", source="sensor"),  # sensors aren't people
    ], now=NOW)
    assert [u["author"] for u in r["unaccounted"]] == ["anon-b", "anon-c"]
    assert r["heard_from"] == 1 and r["known"] == 3
