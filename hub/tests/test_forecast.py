"""Blackout forecast (app/forecast.py): the line fit, when it warns and when it stays quiet."""

import math
import random
from types import SimpleNamespace

from app.forecast import CUTOFF_V, eta_for, fit, forecast_all


def line(v0, per_min, n, every_s=60, noise=0.0, seed=1):
    rnd = random.Random(seed)
    return [(i * every_s, v0 + per_min * i * every_s / 60 + rnd.gauss(0, noise)) for i in range(n)]


def test_fit_recovers_an_exact_line():
    slope, intercept, se = fit([(0, 230), (60, 228), (120, 226), (180, 224)])
    assert math.isclose(slope, -2 / 60) and math.isclose(intercept, 230) and se == 0


def test_a_steady_fall_gives_the_right_eta():
    # 230 V falling 2 V a minute: reaches 180 V 25 minutes after the start
    pts = line(230, -2, 6)  # readings at minutes 0..5
    status, eta, lo, hi, _ = eta_for(pts)
    assert status == "falling"
    assert math.isclose(eta, 20 * 60, rel_tol=1e-6)  # 20 minutes after the newest reading (minute 5)
    assert lo == eta == hi  # a perfect line: no uncertainty


def test_noise_widens_the_range_but_keeps_the_estimate_close():
    status, eta, lo, hi, _ = eta_for(line(230, -2, 8, noise=1.0))
    assert status == "falling"
    assert lo <= eta <= hi
    assert abs(eta - 18 * 60) < 4 * 60  # true answer: 18 minutes after minute 7


def test_steady_power_with_noise_does_not_raise_an_alarm():
    alarms = sum(eta_for(line(229, 0, 8, noise=1.5, seed=s))[0] == "falling" for s in range(200))
    assert alarms <= 10  # t <= -2 lets through only about 2-3% by chance


def test_rising_or_too_few_readings_or_already_below():
    assert eta_for(line(200, +1, 6))[0] == "steady"
    assert eta_for(line(230, -2, 3))[0] == "too few readings"
    assert eta_for([(0, 200), (60, 190), (120, 185), (180, 179)])[0] == "below cutoff"


def test_only_the_newest_readings_count():
    # a long healthy stretch, then a sharp sag: the window sees the sag
    pts = line(230, 0, 30) + [(30 * 60 + i * 60, 228 - 4 * (i + 1)) for i in range(8)]
    assert eta_for(pts)[0] == "falling"


def ev(device, t, volts, signed=True, simulated=True, unit="V"):
    return SimpleNamespace(
        source="sensor", device_id=device, sig="s" if signed else None, level=12, hub_id="hub-L12",
        created_at=f"2026-11-19T12:{t // 60:02d}:{t % 60:02d}.000Z",
        payload={"kind": "other", "reading": {"value": volts, "unit": unit}, **({"simulated": True} if simulated else {})},
    )


def test_forecast_all_uses_signed_volt_readings_per_box():
    events = [ev("relay", i * 60, 230 - 3 * i) for i in range(6)]
    events += [ev("relay", 400, 100, signed=False)]  # unsigned: ignored
    events += [ev("market", i * 60, 1200 + i, unit="ppm CO₂") for i in range(6)]  # not volts: ignored
    [f] = forecast_all(events)
    assert f.device_id == "relay" and f.status == "falling" and f.simulated
    assert math.isclose(f.slope_v_per_min, -3, rel_tol=1e-6)
    assert math.isclose(f.eta_s, (215 - CUTOFF_V) / 3 * 60, rel_tol=1e-6)
    assert f.to_dict()["latest_v"] == 215
