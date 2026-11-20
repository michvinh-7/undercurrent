"""Blackout forecast (question 1: warn before the power cuts out).

A Canary box at a power relay reports its supply voltage every so often. When the
supply is failing, the voltage sags before it drops out. This fits a straight line
(ordinary least squares) through each box's recent readings and, if the line is
clearly falling, estimates when it crosses the cutoff where equipment drops out.

    forecast_for(readings, now)  # readings = [(unix seconds, volts), ...], oldest first

Plain statistics, no model, so every number can be explained and checked:
- slope = volts per second from the fit; it must be falling and clearly so
  (t-statistic of the slope <= -2) before any warning is given, so noise on a
  steady supply doesn't raise alarms
- eta = when the fitted line reaches the cutoff, counted from the newest reading
- eta_low / eta_high = the same with the slope moved by 2 standard errors, an
  honest range rather than one confident number
- only the last WINDOW readings count, so an old, healthy stretch doesn't hide a new sag

Readings come from the hub's own log: signed sensor events whose payload has
reading.unit == "V". Nothing here changes the log.
"""

import math
from dataclasses import asdict, dataclass
from datetime import datetime

CUTOFF_V = 180.0  # below this, relays and pumps drop out (mains is ~230 V)
WINDOW = 8  # newest readings used for the fit
MIN_READINGS = 4  # fewer than this: too little to call a trend
T_MAX = -2.0  # the slope's t-statistic must be at or below this to warn
HORIZON_S = 6 * 3600  # don't forecast further out than this


@dataclass
class Forecast:
    device_id: str
    level: int
    hub_id: str
    readings: int  # used in the fit
    latest_v: float
    latest_at: str
    slope_v_per_min: float
    status: str  # "falling" (a forecast is given), "steady", "below cutoff", "too few readings"
    eta_s: float | None = None  # seconds from the newest reading to the cutoff
    eta_low_s: float | None = None
    eta_high_s: float | None = None
    cutoff_v: float = CUTOFF_V
    simulated: bool = False

    def to_dict(self) -> dict:
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def fit(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Least squares line through (t, v). Returns (slope, intercept, slope's standard error).
    The standard error is 0 for a perfect fit and inf when it can't be estimated."""
    n = len(points)
    mt = sum(t for t, _ in points) / n
    mv = sum(v for _, v in points) / n
    stt = sum((t - mt) ** 2 for t, _ in points)
    if stt == 0:
        return 0.0, mv, math.inf
    slope = sum((t - mt) * (v - mv) for t, v in points) / stt
    intercept = mv - slope * mt
    if n <= 2:
        return slope, intercept, math.inf
    rss = sum((v - (intercept + slope * t)) ** 2 for t, v in points)
    se = math.sqrt(rss / (n - 2) / stt)
    return slope, intercept, se


def eta_for(points: list[tuple[float, float]], cutoff: float = CUTOFF_V) -> tuple[str, float | None, float | None, float | None, float]:
    """(status, eta, eta_low, eta_high, slope) for readings oldest first."""
    pts = points[-WINDOW:]
    if len(pts) < MIN_READINGS:
        return "too few readings", None, None, None, 0.0
    slope, intercept, se = fit(pts)
    t_last = pts[-1][0]
    v_now = intercept + slope * t_last  # the fitted value now, steadier than the last raw reading
    if pts[-1][1] <= cutoff:
        return "below cutoff", 0.0, 0.0, 0.0, slope
    tstat = slope / se if se > 0 else (-math.inf if slope < 0 else math.inf)
    if slope >= 0 or tstat > T_MAX:
        return "steady", None, None, None, slope
    eta = max(0.0, (cutoff - v_now) / slope)
    if eta > HORIZON_S:
        return "steady", None, None, None, slope
    steep, shallow = slope - 2 * se, slope + 2 * se  # both negative-ish: steeper arrives sooner
    eta_low = max(0.0, (cutoff - v_now) / steep)
    eta_high = (cutoff - v_now) / shallow if shallow < 0 else math.inf
    return "falling", eta, eta_low, min(eta_high, HORIZON_S), slope


def _seconds(iso: str) -> float | None:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def volts_of(event) -> float | None:
    """The voltage in a sensor event's payload, or None."""
    reading = (event.payload or {}).get("reading")
    if not isinstance(reading, dict) or reading.get("unit") != "V":
        return None
    value = reading.get("value")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def forecast_all(events, cutoff: float = CUTOFF_V) -> list[Forecast]:
    """One forecast per box that reports volts, from signed sensor events, newest boxes first."""
    by_device: dict[str, list] = {}
    for e in events:
        if e.source != "sensor" or not e.device_id or not e.sig:
            continue
        v, t = volts_of(e), _seconds(e.created_at)
        if v is None or t is None:
            continue
        by_device.setdefault(e.device_id, []).append((t, v, e))
    out = []
    for device, rows in by_device.items():
        rows.sort(key=lambda r: r[0])
        status, eta, lo, hi, slope = eta_for([(t, v) for t, v, _ in rows], cutoff)
        last = rows[-1][2]
        out.append(Forecast(
            device_id=device, level=last.level, hub_id=last.hub_id, readings=min(len(rows), WINDOW),
            latest_v=rows[-1][1], latest_at=last.created_at, slope_v_per_min=slope * 60, status=status,
            eta_s=eta, eta_low_s=lo, eta_high_s=hi, cutoff_v=cutoff,
            simulated=(last.payload or {}).get("simulated") is True,
        ))
    out.sort(key=lambda f: f.latest_at, reverse=True)
    return out
