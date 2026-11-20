"""Collect the newest result per eval, split and model into eval/results/RESULTS.md.

    hub/.venv/bin/python eval/make_results_table.py

This is the table behind the results slide and the Devpost page. The security
headline numbers come first (attacks, sync under cuts, probe latency); then the
triage tables. Only TEST-split triage rows go in the video; dev-split rows are
labeled as tuning numbers.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stats import fmt  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"

# (row label, dotted path into the result JSON, shown as a percentage?)
METRICS: dict[str, list[tuple[str, str, bool]]] = {
    "triage": [
        ("SOS ranked first (batch of 10)", "sos_ranked_first", True),
        ("Urgency accuracy", "urgency_accuracy", True),
        ("SOS recall", "per_class.sos.recall", True),
        ("SOS precision", "per_class.sos.precision", True),
        ("Fakes caught (recall)", "per_class.fake_suspect.recall", True),
        ("Level extracted exactly", "level_exact", True),
        ("People count extracted exactly", "people_count_exact", True),
        ("Fell back to keyword rules", "keyword_fallback_rate", True),
        ("Seconds per message", "latency_s_per_message", False),
        ("SOS delay, first-come-first-served (s)", "link.sos_delay_fifo_s", False),
        ("SOS delay, priority queue (s)", "link.sos_delay_priority_s", False),
        ("SOS delay, fair scheduler (s)", "link.sos_delay_fair_s", False),
        ("SOS delay reduction vs first-come-first-served", "link.sos_delay_reduction", True),
        ("Longest wait of any level, priority (s)", "link.max_level_wait_priority_s", False),
        ("Longest wait of any level, fair (s)", "link.max_level_wait_fair_s", False),
    ],
    "compression": [
        ("Fits in 200 bytes and passes the fact check", "packet_ok", True),
        ("Sent as full message instead (fallback)", "sent_full", True),
        ("Level kept", "facts_kept.level", True),
        ("People count kept", "facts_kept.people_count", True),
        ("Injuries kept", "facts_kept.injuries", True),
        ("Hazard kept", "facts_kept.hazard", True),
        ("Average packet size (bytes)", "packet_bytes", False),
    ],
    "fairness": [
        ("Longest wait on the quiet level, priority only (s)", "quiet_level_worst_wait_priority_s", False),
        ("Longest wait on the quiet level, fair scheduler (s)", "quiet_level_worst_wait_fair_s", False),
        ("Average SOS delay, priority only (s)", "sos_delay_priority_s", False),
        ("Average SOS delay, fair scheduler (s)", "sos_delay_fair_s", False),
        ("Average urgent delay, priority only (s)", "urgent_delay_priority_s", False),
        ("Average urgent delay, fair scheduler (s)", "urgent_delay_fair_s", False),
    ],
}


def get(d: dict, dotted: str):
    for key in dotted.split("."):
        if not isinstance(d, dict) or key not in d:
            return None
        d = d[key]
    return d


def newest_runs() -> dict[tuple[str, str], dict[str, dict]]:
    """{(eval, split): {model: newest result}}"""
    out: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    for path in sorted(RESULTS.glob("*.json")):
        if path.stem.endswith("_misses"):
            continue
        kind = path.stem.split("_", 1)[0]
        data = json.loads(path.read_text())
        if kind not in METRICS or "split" not in data:
            continue
        model = data.get("backend", "?")
        prev = out[(kind, data["split"])].get(model)
        if prev is None or data.get("date", "") >= prev.get("date", ""):
            out[(kind, data["split"])][model] = data
    return out


def table(kind: str, runs: dict[str, dict]) -> list[str]:
    models = sorted(runs)
    lines = [
        "| Metric | " + " | ".join(f"{m} ({runs[m].get('date', '?')}, n={runs[m].get('n', '?')})" for m in models) + " |",
        "|---|" + "---|" * len(models),
    ]
    for label, dotted, pct in METRICS[kind]:
        cells = [get(runs[m], dotted) for m in models]
        if all(c is None for c in cells):
            continue
        lines.append(f"| {label} | " + " | ".join("–" if c is None else fmt(tuple(c), pct=pct) for c in cells) + " |")
    return lines


def newest(prefix: str) -> dict | None:
    """The newest result whose file name starts with `prefix` (by its date, then file name)."""
    found = [json.loads(p.read_text()) | {"_file": p.name} for p in RESULTS.glob(f"{prefix}*.json")]
    return max(found, key=lambda d: (d.get("date", ""), d["_file"]), default=None)


def security_section() -> list[str]:
    attacks, sync = newest("attacks_"), newest("sync_stress_simulated-cuts")
    real_net = newest("sync_stress_real-network")
    probe = newest("probe_latency_real-box") or newest("probe_latency_")  # the real box wins over the dry run
    rows = []
    if attacks:
        rows.append(f"| 1. Forged and replayed messages accepted | **{attacks['attack_accepted']} of {attacks['attack_n']}** "
                    f"(95% upper bound {attacks['attack_accept_upper95'] * 100:.1f}%); real member alerts accepted "
                    f"{attacks['real_accepted']} of {attacks['real_sent']} | real hub, generated attacks | "
                    f"{attacks['date']}, `{attacks['_file']}` |")
        rows.append(f"| 2. Edited records caught at the exact row | **{attacks['edit_caught']} of {attacks['edit_n']}** "
                    f"(95% upper bound on misses {attacks['edit_miss_upper95'] * 100:.1f}%) | direct edits to a copy of a "
                    f"real hub's database | {attacks['date']}, `{attacks['_file']}` |")
        if "restore_n" in attacks:
            rows.append(f"| 2b. Deleted rows put back by the other hub | **{attacks['restored_intact']} of {attacks['restore_n']}**, "
                        f"chain intact, \"forgeries blocked\" counter moved by {attacks['restore_counter_moved']}, "
                        f"median {attacks['restore_median_s']} s | rows deleted from a running hub's database, two real "
                        f"hubs synced | {attacks['date']}, `{attacks['_file']}` |")
    if real_net:
        rows.append(f"| 3. Alerts delivered with the plug really pulled | **{real_net['delivered_to_receiver']} of "
                    f"{real_net['alerts_sent']}** after {real_net['outages']} real outages, {real_net['duplicates']} "
                    f"duplicates, hubs agree: {'yes' if real_net['fingerprints_agree'] else 'no'} | {real_net['how']} | "
                    f"{real_net['date']}, `{real_net['_file']}` |")
    if sync:
        rows.append(f"| 3. Alerts delivered after random link cuts | **{sync['delivered_to_both']} of {sync['alerts_sent']}** "
                    f"after {sync['cuts']} cuts, {sync['duplicates']} duplicates | two real hubs, simulated cuts at "
                    f"{sync['bandwidth_bps']:g} B/s | {sync['date']}, `{sync['_file']}` |")
    if probe:
        rows.append(f"| 4. Water on the probe to the alert on the other hub | **{fmt(tuple(probe['latency_s_ci']), pct=False, digits=2)} s** "
                    f"median, n={probe['n']}, {probe['arrived']} of {probe['n']} arrived | {probe['how']} | "
                    f"{probe['date']}, `{probe['_file']}` |")
    else:
        rows.append("| 4. Water on the probe to the alert on the other hub | not measured yet | needs the Canary box | |")
    out = [
        "## Security headline numbers (use these in the video)",
        "",
        "| Claim | Result | How | Run |",
        "|---|---|---|---|",
        *rows,
        "",
    ]
    if attacks:
        lim = {k: v for k, v in attacks["edits"].items() if not v["counted"]}
        out += [
            "Known limits, measured and not counted: "
            + "; ".join(f"`{k}` edits caught {v['caught_exact_row']} of {v['n']}" for k, v in lim.items())
            + ". `priority` is the hub's own score, outside the hash on purpose. A deleted newest row is caught "
            "because the hub keeps the hash of every event it wrote; erasing that record too hides it from a hub "
            "on its own.",
            "",
        ]
    return out


def forecast_section() -> list[str]:
    """The newest blackout-forecast backtest (eval/run_forecast_eval.py), as written. Synthetic data."""
    found = sorted(RESULTS.glob("forecast_synthetic_*.md"))
    if not found:
        return []
    body = found[-1].read_text().rstrip().splitlines()
    return [body[0] + " (synthetic, say so in the video)", *body[1:], "", f"From `{found[-1].name}`.", ""]


def gym_section() -> list[str]:
    """The newest Directorate gym run (eval/run_directorate_gym.py), as written."""
    found = sorted(RESULTS.glob("directorate_gym_*.md"))
    if not found:
        return []
    return [*found[-1].read_text().rstrip().splitlines(), "", f"From `{found[-1].name}`.", ""]


def main():
    runs = newest_runs()
    out = [
        "# Results",
        "",
        "Generated by `eval/make_results_table.py` from `eval/results/*.json`. Every number is from a real run. "
        "Triage numbers carry a bootstrapped 95% confidence interval in brackets; counts of 0 or N carry a 95% upper "
        "bound. Triage delivery times use the hubs' real link code (`hub/app/link.py`) with simulated arrival times.",
        "",
        *security_section(),
        *gym_section(),
        *forecast_section(),
    ]
    headings = {"test": "use these in the video", "dev": "tuning numbers, NOT for the video",
                "synthetic": "synthetic scenario, say so in the video"}
    for split in ("test", "synthetic", "dev"):
        for kind in METRICS:
            if (kind, split) not in runs:
                continue
            heading = headings[split]
            out += [f"## {kind.capitalize()}, {split} split ({heading})", "", *table(kind, runs[(kind, split)]), ""]
    if not any(split == "test" for _, split in runs):
        out += ["**No test-split runs yet.** Finish tuning on dev, then run each eval once with `--split test`.", ""]
    (RESULTS / "RESULTS.md").write_text("\n".join(out))
    print("\n".join(out))


if __name__ == "__main__":
    main()
