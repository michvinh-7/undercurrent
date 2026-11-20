"""Sleep, mood and the roll call (question 11: what living underground does to people;
question 8: who hasn't been heard from).

The daily check-in can carry two optional answers, both whole numbers so signatures stay
byte-identical across Python and JS:

    {"status": "ok", "sleep_h": 5, "mood": 2}     # hours slept last night, mood 1 (low) to 5 (good)

wellbeing(events) gives, per level:
- each person's LATEST check-in in the window counts once (people who check in twice
  aren't counted twice), by key (author_pub) or, unsigned, by handle
- average hours slept, average mood, share sleeping under 6 hours, share with mood 1-2
- privacy: a level's averages are only given when at least MIN_PEOPLE people answered,
  so one person's mood can't be read off the screen

and a roll call: residents (not sensor boxes) heard from in the last week but not in the
last `window_h` hours, so someone can go and knock. Plain counting, nothing inferred.
"""

from datetime import datetime, timezone

MIN_PEOPLE = 2
SHORT_SLEEP_H = 6
LOW_MOOD = 2
WEEK_S = 7 * 24 * 3600


def _t(e) -> float | None:
    try:
        return datetime.fromisoformat(e.created_at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _person(e) -> str:
    return e.author_pub or f"handle:{e.author}"


def _int(v, lo: int, hi: int) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else None


def wellbeing(events, window_h: float = 24, now: float | None = None) -> dict:
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    since = now - window_h * 3600
    latest: dict[str, tuple[float, object]] = {}  # person -> newest check-in in the window with an answer
    heard: dict[str, tuple[float, object]] = {}  # person -> newest resident event in the last week
    for e in events:
        t = _t(e)
        if t is None or e.source == "sensor" or e.type == "roster":
            continue
        who = _person(e)
        if now - t <= WEEK_S and (who not in heard or t > heard[who][0]):
            heard[who] = (t, e)
        if e.type != "checkin" or t < since:
            continue
        p = e.payload or {}
        if _int(p.get("sleep_h"), 0, 24) is None and _int(p.get("mood"), 1, 5) is None:
            continue
        if who not in latest or t > latest[who][0]:
            latest[who] = (t, e)

    levels: dict[int, list] = {}
    for _, e in latest.values():
        levels.setdefault(e.level, []).append(e.payload or {})
    out_levels = []
    for level in sorted(levels):
        answers = levels[level]
        sleeps = [s for p in answers if (s := _int(p.get("sleep_h"), 0, 24)) is not None]
        moods = [m for p in answers if (m := _int(p.get("mood"), 1, 5)) is not None]
        row = {"level": level, "people": len(answers)}
        if len(answers) < MIN_PEOPLE:
            row["hidden"] = f"fewer than {MIN_PEOPLE} people answered"
        else:
            if sleeps:
                row["sleep_avg_h"] = round(sum(sleeps) / len(sleeps), 1)
                row["short_sleep_share"] = round(sum(s < SHORT_SLEEP_H for s in sleeps) / len(sleeps), 2)
            if moods:
                row["mood_avg"] = round(sum(moods) / len(moods), 1)
                row["low_mood_share"] = round(sum(m <= LOW_MOOD for m in moods) / len(moods), 2)
        out_levels.append(row)

    unaccounted = sorted(
        ({"author": e.author, "level": e.level, "last_heard_h": round((now - t) / 3600, 1)}
         for t, e in heard.values() if t < since),
        key=lambda r: -r["last_heard_h"],
    )
    return {
        "window_h": window_h, "min_people": MIN_PEOPLE, "levels": out_levels,
        "heard_from": sum(1 for t, _ in heard.values() if t >= since), "known": len(heard),
        "unaccounted": unaccounted,
    }
