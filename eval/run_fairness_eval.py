"""Fair scheduler evaluation (Person 2, Upgrade 2): does any level get starved?

    hub/.venv/bin/python eval/run_fairness_eval.py

SYNTHETIC SCENARIO, label it that way wherever it's shown. The labeled message set
never starves anyone (arrivals are random and sparse), so this builds the case
fairness exists for:
  - busy deep levels (31-40) send a steady stream of urgent messages (priority 0.7)
    that keeps the link about 95% full
  - a quiet level (3) sends a routine message (priority 0.25) every 30 s
  - a few SOS messages (0.95) arrive at random
Same link code as the hubs (hub/app/link.py); plain priority vs the fair
scheduler (hub/app/scheduler.py). Repeated over --runs random seeds; CIs are over runs.
"""

import argparse
import json
import random
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.link import event_size  # noqa: E402
from app.models import Event  # noqa: E402
from app.scheduler import DEFAULT_MAX_WAIT_S  # noqa: E402
from run_triage_eval import EvalLink, FairEvalLink, FakeClock  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402

QUIET_LEVEL = 3


def event(i: int, level: int, priority: float, text: str) -> Event:
    return Event(id=f"e{i}", type="checkin", level=level, author="sim", payload={"text": text}, priority=priority,
                 hub_id="hub-sim", created_at="2087-01-01T00:00:00Z", prev_hash="0" * 64, hash="0" * 64)


def scenario(seed: int, duration_s: float, load: float):
    """[(arrival time, event)], plus the bandwidth that makes urgent traffic alone fill `load` of the link."""
    rng = random.Random(seed)
    out, i = [], 0
    urgent_gap = 4.0  # an urgent message every ~4 s from the deep levels
    t = 0.0
    while t < duration_s:
        t += rng.expovariate(1 / urgent_gap)
        out.append((t, event(i, rng.randint(31, 40), 0.7, "water rising in the corridor, need pumps " + "x" * rng.randint(0, 60))))
        i += 1
    for t in range(0, int(duration_s), 30):
        out.append((t + rng.uniform(0, 5), event(i, QUIET_LEVEL, 0.25, "all ok here, checking in")))
        i += 1
    for _ in range(5):
        out.append((rng.uniform(0, duration_s), event(i, rng.randint(1, 40), 0.95, "SOS trapped, not breathing")))
        i += 1
    out.sort(key=lambda x: x[0])
    urgent_bytes = sum(event_size(e) for _, e in out if e.priority == 0.7)
    return out, urgent_bytes / duration_s / load


def run(arrivals, bps: float, link_cls) -> dict[str, float]:
    clock = FakeClock()
    link = link_cls(bandwidth_bps=bps, clock=clock)
    arrived = {e.id: t for t, e in arrivals}
    delays, i = {}, 0
    while True:
        nxt = [t for t in (arrivals[i][0] if i < len(arrivals) else None, link.next_delivery_at()) if t is not None]
        if not nxt:
            break
        clock.t = min(nxt)
        while i < len(arrivals) and arrivals[i][0] <= clock.t:
            link.enqueue(arrivals[i][1])
            i += 1
        for e in link.poll():
            delays[e.id] = clock.t - arrived[e.id]
    return delays


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runs", type=int, default=30)
    ap.add_argument("--duration", type=float, default=600.0, help="seconds of traffic per run")
    ap.add_argument("--load", type=float, default=0.95, help="share of the link the urgent stream alone uses")
    ap.add_argument("--max-wait", type=float, default=DEFAULT_MAX_WAIT_S)
    args = ap.parse_args()
    FairEvalLink.max_wait_s = args.max_wait

    quiet_worst = {"priority": [], "fair": []}
    sos_mean = {"priority": [], "fair": []}
    urgent_mean = {"priority": [], "fair": []}
    for seed in range(args.runs):
        arrivals, bps = scenario(seed, args.duration, args.load)
        level = {e.id: e.level for _, e in arrivals}
        prio = {e.id: e.priority for _, e in arrivals}
        for name, cls in (("priority", EvalLink), ("fair", FairEvalLink)):
            d = run(arrivals, bps, cls)
            quiet_worst[name].append(max(v for k, v in d.items() if level[k] == QUIET_LEVEL and prio[k] < 0.9))
            sos_mean[name].append(sum(v for k, v in d.items() if prio[k] >= 0.9) / sum(prio[k] >= 0.9 for k in d))
            urg = [v for k, v in d.items() if prio[k] == 0.7]
            urgent_mean[name].append(sum(urg) / len(urg))

    results = {
        "split": "synthetic", "backend": "scheduler", "n": args.runs, "date": date.today().isoformat(),
        "duration_s": args.duration, "load": args.load, "max_wait_s": args.max_wait,
        **{f"quiet_level_worst_wait_{p}_s": bootstrap_ci(v) for p, v in quiet_worst.items()},
        **{f"sos_delay_{p}_s": bootstrap_ci(v) for p, v in sos_mean.items()},
        **{f"urgent_delay_{p}_s": bootstrap_ci(v) for p, v in urgent_mean.items()},
    }
    lines = [
        f"## Fair scheduler, SYNTHETIC scenario ({args.runs} runs × {args.duration:g} s, urgent stream uses "
        f"{args.load:.0%} of the link, limit {args.max_wait:g} s)",
        "",
        "| Metric | Priority only | Fair scheduler |",
        "|---|---|---|",
        f"| Longest wait on the quiet level {QUIET_LEVEL} | {fmt(results['quiet_level_worst_wait_priority_s'], pct=False)} s "
        f"| {fmt(results['quiet_level_worst_wait_fair_s'], pct=False)} s |",
        f"| Average SOS delay | {fmt(results['sos_delay_priority_s'], pct=False)} s "
        f"| {fmt(results['sos_delay_fair_s'], pct=False)} s |",
        f"| Average urgent delay (busy levels) | {fmt(results['urgent_delay_priority_s'], pct=False)} s "
        f"| {fmt(results['urgent_delay_fair_s'], pct=False)} s |",
    ]
    table = "\n".join(lines)
    print(table)
    stem = f"fairness_synthetic_scheduler_{date.today().isoformat()}"
    (ROOT / "eval" / "results" / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (ROOT / "eval" / "results" / f"{stem}.md").write_text(table + "\n")
    print(f"\nwrote eval/results/{stem}.*", file=sys.stderr)


if __name__ == "__main__":
    main()
