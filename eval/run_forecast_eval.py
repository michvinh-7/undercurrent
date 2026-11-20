"""Backtest the blackout forecast (hub/app/forecast.py) on synthetic voltage sags.

Question 1 asks how to warn people before the power cuts out. The hub fits a line to a
relay box's voltage readings and estimates when it crosses the cutoff (180 V). This
measures how good that estimate is, against a naive baseline, on generated supplies
whose true drop-out time is known:

- sags: start 224-234 V, fall 0.2-3 V a minute, a reading every 5 minutes, sensor
  noise of 0.5-2.5 V. True drop-out = when the noiseless line reaches 180 V.
- steady supplies: the same, but not falling. Any "falling" call within the hour on
  these is a false alarm.
- baseline: the slope from the last two readings only (what you'd do by eye).

Reported, with bootstrapped 95% intervals:
- error of the predicted drop-out time, 60, 30 and 15 minutes before it happens
- how often the true time falls inside the forecast's range (eta_low..eta_high)
- how often a sag is warned about at least 15 minutes ahead
- false alarm rate on steady supplies

    hub/.venv/bin/python eval/run_forecast_eval.py            # n=1000 of each, seed 7
    hub/.venv/bin/python eval/run_forecast_eval.py --n 200 --seed 1

Synthetic data, so say so wherever the numbers are used. Writes
eval/results/forecast_synthetic_<date>.json and .md.
"""

import argparse
import json
import random
import sys
from datetime import date
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(ROOT / "eval"))

from app.forecast import CUTOFF_V, eta_for  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402

EVERY_MIN = 5
LEADS = (60, 30, 15)  # minutes before the true drop-out


def series(rng: random.Random, rate: float, noise: float, n: int) -> tuple[list[tuple[float, float]], float]:
    """Readings (seconds, volts) and the start voltage."""
    v0 = rng.uniform(224, 234)
    return [(i * EVERY_MIN * 60, v0 - rate * i * EVERY_MIN + rng.gauss(0, noise)) for i in range(n)], v0


def two_point(points: list[tuple[float, float]]) -> float | None:
    """Baseline: seconds to the cutoff from the last two readings' slope, or None if not falling."""
    (t1, v1), (t2, v2) = points[-2], points[-1]
    slope = (v2 - v1) / (t2 - t1)
    if slope >= 0 or v2 <= CUTOFF_V:
        return None
    return (CUTOFF_V - v2) / slope


def run(n: int, seed: int) -> dict:
    rng = random.Random(seed)
    errors = {lead: {"forecast": [], "baseline": []} for lead in LEADS}
    covered, warned_15, warned_any, leads_at_warning = [], [], [], []
    for _ in range(n):
        rate, noise = rng.uniform(0.2, 3.0), rng.uniform(0.5, 2.5)
        v0 = rng.uniform(224, 234)
        true_min = (v0 - CUTOFF_V) / rate  # minutes from the first reading
        k_total = int(true_min // EVERY_MIN) + 1  # readings before the drop-out
        pts = [(i * EVERY_MIN * 60, v0 - rate * i * EVERY_MIN + rng.gauss(0, noise)) for i in range(k_total)]
        first_warning_lead = None
        for k in range(2, len(pts) + 1):
            hist = pts[:k]
            t_now_min = hist[-1][0] / 60
            lead = true_min - t_now_min
            status, eta, lo, hi, _ = eta_for(hist)
            if status == "falling" and first_warning_lead is None:
                first_warning_lead = lead
            for target in LEADS:
                if target - EVERY_MIN < lead <= target:  # the reading closest to `target` minutes out
                    if status == "falling":
                        errors[target]["forecast"].append(abs(t_now_min + eta / 60 - true_min))
                        if target == 30:
                            covered.append(1.0 if t_now_min + lo / 60 <= true_min <= t_now_min + hi / 60 else 0.0)
                    b = two_point(hist)
                    if b is not None:
                        errors[target]["baseline"].append(abs(t_now_min + b / 60 - true_min))
        warned_15.append(1.0 if first_warning_lead is not None and first_warning_lead >= 15 else 0.0)
        warned_any.append(1.0 if first_warning_lead is not None and first_warning_lead > 0 else 0.0)
        if first_warning_lead is not None and first_warning_lead > 0:
            leads_at_warning.append(first_warning_lead)

    false_alarms, base_false = [], []
    for _ in range(n):
        pts, _ = series(rng, 0.0, rng.uniform(0.5, 2.5), 12)
        alarm = base = False
        for k in range(2, len(pts) + 1):
            status, eta, *_ = eta_for(pts[:k])
            alarm |= status == "falling" and eta is not None and eta <= 3600
            b = two_point(pts[:k])
            base |= b is not None and b <= 3600
        false_alarms.append(1.0 if alarm else 0.0)
        base_false.append(1.0 if base else 0.0)

    med = lambda xs: median(xs) if xs else float("nan")  # noqa: E731
    out = {"n_sags": n, "n_steady": n, "seed": seed, "every_min": EVERY_MIN, "cutoff_v": CUTOFF_V, "leads": {}}
    for lead in LEADS:
        f, b = errors[lead]["forecast"], errors[lead]["baseline"]
        out["leads"][lead] = {
            "forecast_median_abs_err_min": bootstrap_ci(f, med) if f else None,
            "baseline_median_abs_err_min": bootstrap_ci(b, med) if b else None,
            "forecast_n": len(f), "baseline_n": len(b),
        }
    out["range_covers_truth_at_30"] = bootstrap_ci(covered) if covered else None
    out["warned_15_min_ahead"] = bootstrap_ci(warned_15)
    out["warned_before_dropout"] = bootstrap_ci(warned_any)
    out["first_warning_lead_min"] = bootstrap_ci(leads_at_warning, med) if leads_at_warning else None
    out["false_alarm_steady"] = bootstrap_ci(false_alarms)
    out["false_alarm_steady_baseline"] = bootstrap_ci(base_false)
    return out


def table(r: dict) -> str:
    rows = [
        f"## Blackout forecast, synthetic voltage sags ({date.today().isoformat()}, n={r['n_sags']} sags + {r['n_steady']} steady supplies)",
        "",
        "| Metric | Forecast (line fit, last 8 readings) | Baseline (last 2 readings) |",
        "|---|---|---|",
    ]
    for lead, m in r["leads"].items():
        f = fmt(m["forecast_median_abs_err_min"], pct=False) if m["forecast_median_abs_err_min"] else "–"
        b = fmt(m["baseline_median_abs_err_min"], pct=False) if m["baseline_median_abs_err_min"] else "–"
        rows.append(f"| Error in predicted drop-out time, {lead} min before it (median, min) | {f} | {b} |")
    rows += [
        f"| Sags warned before they drop out | {fmt(r['warned_before_dropout'])} | – |",
        f"| How far ahead the first warning comes (median, min) | {fmt(r['first_warning_lead_min'], pct=False) if r['first_warning_lead_min'] else '–'} | – |",
        f"| Sags warned at least 15 min ahead (the fastest drop out in ~15 min, before 4 readings exist) | {fmt(r['warned_15_min_ahead'])} | – |",
        f"| True time inside the forecast's range, 30 min out | {fmt(r['range_covers_truth_at_30']) if r['range_covers_truth_at_30'] else '–'} | – |",
        f"| False alarms on steady supplies (within the hour) | {fmt(r['false_alarm_steady'])} | {fmt(r['false_alarm_steady_baseline'])} |",
        f"| Setup | readings every {r['every_min']} min, cutoff {r['cutoff_v']:.0f} V, synthetic, seed {r['seed']} | |",
    ]
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(ROOT / "eval" / "results"))
    args = ap.parse_args()
    r = run(args.n, args.seed)
    md = table(r)
    stem = f"forecast_synthetic_{date.today().isoformat()}"
    out = Path(args.out)
    (out / f"{stem}.json").write_text(json.dumps(r, indent=2))
    (out / f"{stem}.md").write_text(md + "\n")
    print(md + f"\n\nwrote {out / stem}.*")


if __name__ == "__main__":
    main()
