"""Triage evaluation (Person 2). Every number comes with a bootstrapped 95% CI.

    hub/.venv/bin/python eval/run_triage_eval.py --split dev               # tune on this
    hub/.venv/bin/python eval/run_triage_eval.py --split test              # report this, never tune on it
    hub/.venv/bin/python eval/run_triage_eval.py --split dev --backend keywords   # no model needed

Metrics
- SOS ranked first: put each SOS message in a batch with 9 random non-SOS messages
  from the same split; how often does it get the top priority? (ties count half)
- Urgency precision/recall per class, field accuracy for level and people count,
  and how often the model path fell back to keyword rules.
- Time-to-deliver for SOS messages over the hubs' real link code (hub/app/link.py),
  priority queue vs first-come-first-served. The link code is real; the arrival
  times are simulated (messages arrive at random over --window seconds), so say
  "simulated arrivals" wherever it's shown.

Use other messages (e.g. Alanna's simulator output, same JSONL fields) with --messages PATH.
"""

import argparse
import json
import os
import random
import sys
import time
from datetime import date
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from app.link import Link  # noqa: E402
from app.models import Event  # noqa: E402
from app.triage import backend, keyword_triage, triage  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402

LABEL_TO_URGENCY = {"sos": "sos", "urgent": "urgent", "routine": "routine", "fake": "fake_suspect"}
CLASSES = list(LABEL_TO_URGENCY.values())


DEFAULT_MESSAGES = ROOT / "eval" / "messages_labeled.jsonl"


def load(split: str, path: Path = DEFAULT_MESSAGES) -> list[dict]:
    rows = [json.loads(line) for line in Path(path).open()]
    return rows if split == "all" else [r for r in rows if r["split"] == split]


def model_label(mode: str) -> str:
    """Which model actually produced the numbers, for filenames and table titles."""
    if mode == "keywords":
        return "keywords"
    if backend() == "cloud":
        return "gemini-" + os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").removeprefix("gemini-")
    return "ollama-" + os.getenv("OLLAMA_MODEL", "llama3.2:3b").replace(":", "-")


def run_triage(rows: list[dict], mode: str, rpm: float | None = None) -> list[dict]:
    out, last_call = [], 0.0
    for r in rows:
        if rpm and mode != "keywords":  # stay under API rate limits (Gemini free tier)
            time.sleep(max(0.0, last_call + 60 / rpm - time.monotonic()))
            last_call = time.monotonic()
        t0 = time.perf_counter()
        rec = keyword_triage(r["text"]) if mode == "keywords" else triage(r["text"])
        out.append({**r, "pred": rec.model_dump(), "latency_s": time.perf_counter() - t0,
                    "truth": LABEL_TO_URGENCY[r["label"]]})
    return out


# --------------------------------------------------------------------------- metrics

def sos_first_per_message(rows: list[dict], batches: int, seed: int) -> list[float]:
    rng = random.Random(seed)
    others = [r["pred"]["priority"] for r in rows if r["truth"] != "sos"]
    per_sos = []
    for r in (r for r in rows if r["truth"] == "sos"):
        wins = 0.0
        for _ in range(batches):
            top_other = max(rng.sample(others, min(9, len(others))))
            p = r["pred"]["priority"]
            wins += 1.0 if p > top_other else 0.5 if p == top_other else 0.0
        per_sos.append(wins / batches)
    return per_sos


def precision(cls):
    def stat(rs):
        predicted = [r for r in rs if r["pred"]["urgency"] == cls]
        return sum(r["truth"] == cls for r in predicted) / len(predicted) if predicted else float("nan")
    return stat


def recall(cls):
    def stat(rs):
        actual = [r for r in rs if r["truth"] == cls]
        return sum(r["pred"]["urgency"] == cls for r in actual) / len(actual) if actual else float("nan")
    return stat


def field_match(field):
    return lambda rs: mean(r["pred"][field] == r[field] for r in rs)


# --------------------------------------------------------------------------- link (real hub code)

class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class EvalLink(Link):
    """hub/app/link.py as-is, plus a read-only peek at when the in-flight event lands."""

    def next_delivery_at(self) -> float | None:
        return self._sending[1] if self._sending else None


def as_event(r: dict, prioritized: bool) -> Event:
    """The message as the hub would carry it. FIFO sends every event unscored,
    so Link's tie-break (arrival order) makes it first-come-first-served."""
    return Event(
        id=r["id"], type=r["pred"]["type"], level=r.get("level") or r["pred"]["level"] or 1,
        author="eval", payload={"text": r["text"]},
        priority=r["pred"]["priority"] if prioritized else None,
        hub_id="hub-eval", created_at="2087-01-01T00:00:00Z", prev_hash="0" * 64, hash="0" * 64,
    )


def run_link(rows: list[dict], policy: str, bandwidth_bps: float, window_s: float, seed: int,
             link_cls: type[EvalLink] = EvalLink) -> dict[str, float]:
    """Push every message through one link; messages arrive at random over `window_s`.
    Returns delivery delay (s) per message id."""
    rng = random.Random(seed)
    arrivals = sorted((rng.uniform(0, window_s), r["id"], r) for r in rows)
    arrived_at = {mid: t for t, mid, _ in arrivals}
    clock = FakeClock()
    link = link_cls(bandwidth_bps=bandwidth_bps, clock=clock)
    delays, i = {}, 0
    while True:
        next_arrival = arrivals[i][0] if i < len(arrivals) else None
        next_delivery = link.next_delivery_at()
        candidates = [t for t in (next_arrival, next_delivery) if t is not None]
        if not candidates:
            break
        clock.t = min(candidates)
        while i < len(arrivals) and arrivals[i][0] <= clock.t:
            link.enqueue(as_event(arrivals[i][2], prioritized=policy != "fifo"))
            i += 1
        for e in link.poll():
            delays[e.id] = clock.t - arrived_at[e.id]
    assert len(delays) == len(rows), "link lost messages"
    return delays


POLICIES = {"fifo": EvalLink, "priority": EvalLink}


def link_delays(rows, bandwidth_bps, window_s, runs, seed):
    """Per policy: mean delay per message across `runs` random arrival orders."""
    out = {}
    for policy, cls in POLICIES.items():
        totals = {r["id"]: 0.0 for r in rows}
        for k in range(runs):
            for mid, d in run_link(rows, policy, bandwidth_bps, window_s, seed + k, cls).items():
                totals[mid] += d / runs
        out[policy] = totals
    return out


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", choices=["dev", "test", "all"], default="dev")
    ap.add_argument("--backend", choices=["auto", "keywords"], default="auto",
                    help="auto = Ollama (or Gemini if CLOUD_PROVIDER=gemini) with keyword fallback")
    ap.add_argument("--batches", type=int, default=200)
    ap.add_argument("--messages", type=Path, default=DEFAULT_MESSAGES,
                    help="labeled messages JSONL (default: eval/messages_labeled.jsonl)")
    ap.add_argument("--bandwidth", type=float, default=50.0, help="link bandwidth, bytes per second")
    ap.add_argument("--window", type=float, default=120.0, help="seconds over which messages arrive")
    ap.add_argument("--runs", type=int, default=50, help="random arrival orders to average over")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--rpm", type=float, default=None,
                    help="max model requests per minute (e.g. 10 for the Gemini free tier)")
    ap.add_argument("--max-fallback", type=float, default=0.5,
                    help="don't save results if more than this share fell back to keywords")
    args = ap.parse_args()

    if args.split == "test":
        print("TEST SPLIT: report these numbers, do not tune on them.\n", file=sys.stderr)

    rows = load(args.split, args.messages)
    if args.backend == "auto":
        probe = triage(rows[0]["text"])
        if probe.source == "keywords":
            hint = ("check GEMINI_API_KEY, GEMINI_MODEL and your Gemini quota" if backend() == "cloud"
                    else "is `ollama serve` running and the model pulled?")
            sys.exit(f"The {backend()} backend didn't answer ({hint}). "
                     "Every message would fall back to keyword rules. "
                     "Fix the model, or run with --backend keywords on purpose.")
    label = model_label(args.backend)
    rows = run_triage(rows, args.backend, args.rpm)
    n_sos = sum(r["truth"] == "sos" for r in rows)
    fallback = mean(r["pred"]["source"] == "keywords" for r in rows)
    if args.backend == "auto" and fallback > args.max_fallback:
        sys.exit(f"{fallback:.0%} of messages fell back to keyword rules, so these aren't {label} numbers. "
                 "Nothing saved. Likely a rate limit: retry with --rpm (e.g. --rpm 10).")

    results = {
        "split": args.split, "backend": label, "n": len(rows), "n_sos": n_sos,
        "date": date.today().isoformat(),
        "sos_ranked_first": bootstrap_ci(sos_first_per_message(rows, args.batches, args.seed)),
        "urgency_accuracy": bootstrap_ci(rows, lambda rs: mean(r["pred"]["urgency"] == r["truth"] for r in rs)),
        "per_class": {c: {"precision": bootstrap_ci(rows, precision(c)), "recall": bootstrap_ci(rows, recall(c))}
                      for c in CLASSES},
        "level_exact": bootstrap_ci(rows, field_match("level")),
        "people_count_exact": bootstrap_ci(rows, field_match("people_count")),
        "keyword_fallback_rate": bootstrap_ci([float(r["pred"]["source"] == "keywords") for r in rows]),
        "latency_s_per_message": bootstrap_ci([r["latency_s"] for r in rows]),
    }
    delays = link_delays(rows, args.bandwidth, args.window, args.runs, args.seed)
    sos_ids = [r["id"] for r in rows if r["truth"] == "sos"]
    sos = {p: [d[mid] for mid in sos_ids] for p, d in delays.items()}
    results["link"] = {
        "code": "hub/app/link.py", "arrivals": "simulated",
        "bandwidth_bps": args.bandwidth, "window_s": args.window, "runs": args.runs,
        **{f"sos_delay_{p}_s": bootstrap_ci(v) for p, v in sos.items()},
        "sos_delay_reduction": bootstrap_ci(list(zip(sos["fifo"], sos["priority"])),
                                            lambda ps: 1 - mean(p for _, p in ps) / mean(f for f, _ in ps)),
    }

    sl = results["link"]
    lines = [
        f"## Triage results: {args.split} split, {label} ({len(rows)} messages, {n_sos} SOS)",
        "",
        "| Metric | Value [95% CI] |",
        "|---|---|",
        f"| SOS ranked first in a batch of 10 | {fmt(results['sos_ranked_first'])} |",
        f"| Urgency accuracy | {fmt(results['urgency_accuracy'])} |",
        *(f"| {c}: precision / recall | {fmt(v['precision'])} / {fmt(v['recall'])} |"
          for c, v in results["per_class"].items()),
        f"| Level extracted exactly | {fmt(results['level_exact'])} |",
        f"| People count extracted exactly | {fmt(results['people_count_exact'])} |",
        f"| Fell back to keyword rules | {fmt(results['keyword_fallback_rate'])} |",
        f"| Seconds per message | {fmt(results['latency_s_per_message'], pct=False, digits=3)} |",
        f"| SOS delay, first-come-first-served (link.py at {args.bandwidth:g} B/s, simulated arrivals) "
        f"| {fmt(sl['sos_delay_fifo_s'], pct=False)} s |",
        f"| SOS delay, priority queue (link.py, simulated arrivals) | {fmt(sl['sos_delay_priority_s'], pct=False)} s |",
        f"| SOS delay reduction (link.py, simulated arrivals) | {fmt(sl['sos_delay_reduction'])} |",
    ]
    table = "\n".join(lines)
    print(table)

    out_dir = ROOT / "eval" / "results"
    out_dir.mkdir(exist_ok=True)
    stem = f"triage_{args.split}_{label}_{date.today().isoformat()}"
    (out_dir / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out_dir / f"{stem}.md").write_text(table + "\n")
    misses = [{"id": r["id"], "text": r["text"], "truth": r["truth"], "pred": r["pred"]["urgency"]}
              for r in rows if r["pred"]["urgency"] != r["truth"]]
    if args.split != "test":  # only look at individual errors on dev
        (out_dir / f"{stem}_misses.json").write_text(json.dumps(misses, indent=2))
    print(f"\nwrote eval/results/{stem}.*", file=sys.stderr)


if __name__ == "__main__":
    main()
