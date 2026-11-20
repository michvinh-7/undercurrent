"""The Livability Index (question 3: keep every level livable). One score per level, 0-100,
built only from signed events, with every number traceable to the events behind it.

Eight dimensions, each scored 0 (unlivable) to 100 (fine) by a plain rule:

    dimension      weight  from                                    rule
    flooding       1.0     probe cm, or flooding reports            100 - 5 per cm (0 at 20 cm)
    water          1.0     bad_water reports                        severity
    air            1.0     CO2 ppm, oxygen %, or bad_air reports    100 at <= 1000 ppm, 0 at 2500; 100 at >= 20% O2, 0 at 17%
    heat           0.75    temperature, or heat reports             100 at <= 27 C, 0 at 40 C
    power          0.75    relay volts + the blackout forecast      100 at >= 220 V, 0 at 180 V; at most 40 when the
                           or blackout reports                      forecast says it drops out within the hour
    health         1.0     case reports in the window               100 - 8 per person affected
    needs          0.5     unmet Have / Need requests (exchange.py) 100 - 15 per unmet need
    people         0.5     sleep and mood (wellbeing.py)            sleep 4 h -> 0, 8 h -> 100; mood 1 -> 0, 5 -> 100
                                                                    (only where 2+ people answered, as on /wellbeing)

Severity of a resident report: low 80, medium 50, high 20. Where both a sensor and a report
speak to a dimension, the lower (worse) of the two newest counts: a probe that reads dry
doesn't cancel a resident standing in water.

The level's index is the weighted mean over the dimensions that have data, with one rule
on top: if any dimension is below 25 the index is capped at 49 ("unsafe"), because no
amount of good sleep makes 2400 ppm of CO2 livable. Bands: 80+ livable, 50-79 strained,
under 50 unsafe. A dimension with no data is "no data", never a free 100, and `coverage`
says how many dimensions the score rests on.

Only signed events count (an unsigned one is counted in `ignored_unsigned`). Nothing here is
inferred by a model and nothing changes the log.
"""

from datetime import datetime, timezone

from .exchange import board
from .forecast import forecast_all
from .wellbeing import wellbeing

WEIGHTS = {"flooding": 1.0, "water": 1.0, "air": 1.0, "heat": 0.75, "power": 0.75,
           "health": 1.0, "needs": 0.5, "people": 0.5}
SEVERITY = {"low": 80, "medium": 50, "high": 20}
UNSAFE_DIMENSION = 25
UNSAFE_CAP = 49
BANDS = ((80, "livable"), (50, "strained"), (0, "unsafe"))
HAZARD_DIMENSION = {"flooding": "flooding", "bad_water": "water", "bad_air": "air", "heat": "heat", "blackout": "power"}


def _clamp(x: float) -> int:
    return int(round(max(0.0, min(100.0, x))))


def _ramp(value: float, good: float, bad: float) -> int:
    """100 at `good`, 0 at `bad`, straight line between (either direction)."""
    return _clamp(100 * (value - bad) / (good - bad))


def _t(e) -> float | None:
    try:
        return datetime.fromisoformat(e.created_at.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def _reading(p: dict) -> tuple[float, str] | None:
    r = p.get("reading")
    if isinstance(r, dict) and isinstance(r.get("value"), (int, float)) and isinstance(r.get("unit"), str):
        return float(r["value"]), r["unit"]
    return None


def sensor_score(p: dict) -> tuple[str, int, str] | None:
    """(dimension, score, why) for a sensor reading, or None if it isn't one we score."""
    if isinstance(p.get("oxygen_pct"), (int, float)) and p["oxygen_pct"] < 20:
        o2 = p["oxygen_pct"]
        return "air", _ramp(o2, 20, 17), f"oxygen {o2}%"
    r = _reading(p)
    if r is None:
        return None
    value, unit = r
    if unit == "cm":
        return "flooding", _clamp(100 - 5 * value), f"water {value:g} cm"
    if unit.startswith("ppm"):
        return "air", _ramp(value, 1000, 2500), f"CO₂ {value:g} ppm"
    if unit in ("°C", "C"):
        return "heat", _ramp(value, 27, 40), f"{value:g} °C"
    if unit == "V":
        return "power", _ramp(value, 220, 180), f"{value:g} V"
    return None


def _n(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _band(score: int) -> str:
    return next(name for floor, name in BANDS if score >= floor)


def livability(events, window_h: float = 6, now: float | None = None) -> dict:
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    since = now - window_h * 3600
    signed = [e for e in events if e.sig and e.type != "roster"]
    ignored = sum(1 for e in events if not e.sig and e.type != "roster")
    recent = [e for e in signed if (t := _t(e)) is not None and since <= t <= now + 300]

    # level -> dimension -> {"sensor": (t, score, why, e), "report": (t, score, why, e)}; newest of each wins
    newest: dict[int, dict[str, dict[str, tuple]]] = {}
    health: dict[int, list] = {}

    def keep(level, dim, kind, t, score, why, e):
        slot = newest.setdefault(level, {}).setdefault(dim, {})
        if kind not in slot or t > slot[kind][0]:
            slot[kind] = (t, score, why, e)

    for e in recent:
        p, t = e.payload or {}, _t(e)
        if e.type == "hazard":
            s = sensor_score(p) if e.source == "sensor" else None
            if s:
                keep(e.level, s[0], "sensor", t, s[1], s[2], e)
            elif (dim := HAZARD_DIMENSION.get(p.get("kind"))) and p.get("severity") in SEVERITY:
                keep(e.level, dim, "report", t, SEVERITY[p["severity"]], f"{p['severity']} {p.get('kind')} report", e)
        elif e.type == "case":
            health.setdefault(e.level, []).append(e)

    # The blackout forecast: a relay that will drop out within the hour caps power at 40.
    falling = {f.level: f for f in forecast_all(signed) if f.status == "falling" and f.eta_s is not None}

    levels = sorted({*newest, *health} | {f.level for f in falling.values()})
    ex = board(signed, now)  # an old request that's still unmet still counts
    unmet = {}
    for n in ex["needs"]:
        if not n["matched"]:
            unmet.setdefault(n["level"], []).append(n["id"])
    levels = sorted(set(levels) | set(unmet))
    wb = {row["level"]: row for row in wellbeing(recent, window_h, now)["levels"] if "hidden" not in row}
    levels = sorted(set(levels) | set(wb))

    out = []
    for level in levels:
        dims: dict[str, dict] = {}
        for dim, slot in newest.get(level, {}).items():
            worst = min(slot.values(), key=lambda v: v[1])
            dims[dim] = {"score": worst[1], "why": worst[2],
                         "events": sorted(v[3].id for v in slot.values()),
                         "from": sorted(slot)}
        if (f := falling.get(level)) and f.eta_s <= 3600:
            d = dims.setdefault("power", {"score": 100, "why": "", "events": [], "from": []})
            if d["score"] > 40:
                d["score"] = 40
            d["why"] = (d["why"] + "; " if d["why"] else "") + f"forecast: drops out in ~{round(f.eta_s / 60)} min"
            d["from"] = sorted(set(d["from"]) | {"forecast"})
        if cases := health.get(level):
            people = sum(int(c.payload.get("people_affected") or 1) for c in cases)
            dims["health"] = {"score": _clamp(100 - 8 * people), "why": f"{_n(people, 'person', 'people')} sick in {_n(len(cases), 'report', 'reports')}",
                              "events": sorted(c.id for c in cases), "from": ["report"]}
        if ids := unmet.get(level):
            dims["needs"] = {"score": _clamp(100 - 15 * len(ids)), "why": _n(len(ids), "unmet request", "unmet requests"),
                             "events": sorted(ids), "from": ["exchange"]}
        if row := wb.get(level):
            parts = []
            if "sleep_avg_h" in row:
                parts.append(_ramp(row["sleep_avg_h"], 8, 4))
            if "mood_avg" in row:
                parts.append(_ramp(row["mood_avg"], 5, 1))
            if parts:
                dims["people"] = {"score": _clamp(sum(parts) / len(parts)),
                                  "why": f"sleep {row.get('sleep_avg_h', '?')} h, mood {row.get('mood_avg', '?')}/5 ({row['people']} people)",
                                  "events": [], "from": ["checkins"]}
        if not dims:
            continue
        total_w = sum(WEIGHTS[d] for d in dims)
        score = _clamp(sum(WEIGHTS[d] * v["score"] for d, v in dims.items()) / total_w)
        worst_dim = min(dims, key=lambda d: (dims[d]["score"], -WEIGHTS[d]))
        capped = dims[worst_dim]["score"] < UNSAFE_DIMENSION and score > UNSAFE_CAP
        if capped:
            score = UNSAFE_CAP
        out.append({
            "level": level, "score": score, "band": _band(score), "capped": capped,
            "limited_by": worst_dim, "limited_why": dims[worst_dim]["why"],
            "coverage": len(dims), "of": len(WEIGHTS),
            "dimensions": {d: dims[d] for d in WEIGHTS if d in dims},
        })
    out.sort(key=lambda r: (r["score"], r["level"]))
    return {"window_h": window_h, "weights": WEIGHTS, "levels": out, "ignored_unsigned": ignored}
