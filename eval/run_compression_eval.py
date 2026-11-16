"""Compression evaluation (Person 2, Upgrade 2). Every number has a bootstrapped 95% CI.

    hub/.venv/bin/python eval/run_compression_eval.py --split dev                    # tune on this
    hub/.venv/bin/python eval/run_compression_eval.py --split test                   # report this
    hub/.venv/bin/python eval/run_compression_eval.py --split dev --backend keywords # no LLM needed

Needs the NLI model downloaded once: hub/.venv/bin/python hub/scripts/download_nli.py

For each long message (eval/long_messages.jsonl):
  1. triage it (model, or keyword rules) to get the facts compression must keep
  2. compress it to a 200-byte packet (hub/app/compress.py)
  3. check the packet against the HAND-LABELED facts with the same fact check,
     which catches facts triage missed, so compression wasn't told to keep them

Metrics
- packet_ok:  fits in 200 bytes and passed the fact check (not sent as full message)
- sent_full:  fell back to sending the full message (the safe failure)
- facts_kept: per fact type, among compressed packets, share where the labeled fact survived
- packet_bytes: average size of compressed packets
"""

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from app.compress import BUDGET_BYTES, NLIUnavailable, compress, default_scorer, facts_of, verify  # noqa: E402
from app.triage import Extraction, keyword_triage, triage  # noqa: E402
from run_triage_eval import model_label  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402

FACTS = ("level", "people_count", "injuries", "hazard")


def labeled_facts(r: dict):
    return facts_of(Extraction(type="case", urgency="urgent", level=r["level"], people_count=r["people_count"],
                               injuries=r["injuries"], hazard=r["hazard"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", choices=["dev", "test", "all"], default="dev")
    ap.add_argument("--backend", choices=["auto", "keywords"], default="auto",
                    help="auto = triage + rewrite with Ollama (or Gemini); keywords = rules only, no LLM")
    ap.add_argument("--messages", type=Path, default=ROOT / "eval" / "long_messages.jsonl")
    args = ap.parse_args()

    try:
        scorer = default_scorer()
    except NLIUnavailable as e:
        sys.exit(f"Fact-check model unavailable ({e}). Run: hub/.venv/bin/python hub/scripts/download_nli.py")
    if args.split == "test":
        print("TEST SPLIT: report these numbers, do not tune on them.\n", file=sys.stderr)

    rows = [json.loads(line) for line in args.messages.open()]
    rows = rows if args.split == "all" else [r for r in rows if r["split"] == args.split]
    label = model_label(args.backend)
    use_model = args.backend != "keywords"

    out = []
    for r in rows:
        record = keyword_triage(r["text"]) if not use_model else triage(r["text"])
        packet = compress(r["text"], record, scorer=scorer, use_model=use_model)
        kept = {}
        if not packet.full:
            for f in labeled_facts(r):
                kept[f.name] = verify([f], packet.text, scorer).passed
        out.append({"id": r["id"], "words": r["words"], "orig_bytes": len(r["text"].encode()),
                    "method": packet.method, "full": packet.full, "bytes": packet.bytes,
                    "packet": packet.text, "kept": kept, "tried": packet.tried, "triage_source": record.source})
        print(f"{r['id']}: {packet.method:8s} {packet.bytes:4d} B  kept={kept}", file=sys.stderr)

    compressed = [o for o in out if not o["full"]]
    results = {
        "split": args.split, "backend": label, "n": len(out), "date": date.today().isoformat(),
        "budget_bytes": BUDGET_BYTES,
        "packet_ok": bootstrap_ci([float(not o["full"]) for o in out]),
        "sent_full": bootstrap_ci([float(o["full"]) for o in out]),
        "facts_kept": {f: bootstrap_ci([float(o["kept"][f]) for o in compressed if f in o["kept"]]) for f in FACTS},
        "facts_kept_n": {f: sum(f in o["kept"] for o in compressed) for f in FACTS},
        "packet_bytes": bootstrap_ci([o["bytes"] for o in compressed]),
        "methods": dict(Counter(o["method"] for o in out)),
        "words_median": sorted(o["words"] for o in out)[len(out) // 2],
    }

    lines = [
        f"## Compression results: {args.split} split, {label} ({len(out)} messages, "
        f"median {results['words_median']} words, budget {BUDGET_BYTES} bytes)",
        "",
        "| Metric | Value [95% CI] |",
        "|---|---|",
        f"| Fits in {BUDGET_BYTES} bytes and passes the fact check | {fmt(results['packet_ok'])} |",
        f"| Sent as full message instead (safe fallback) | {fmt(results['sent_full'])} |",
        *(f"| {f.replace('_', ' ').capitalize()} kept (n={results['facts_kept_n'][f]}) | {fmt(results['facts_kept'][f])} |"
          for f in FACTS),
        f"| Average packet size | {fmt(results['packet_bytes'], pct=False, digits=0)} bytes |",
        f"| How packets were made | {', '.join(f'{k}: {v}' for k, v in sorted(results['methods'].items()))} |",
    ]
    table = "\n".join(lines)
    print(table)

    out_dir = ROOT / "eval" / "results"
    stem = f"compression_{args.split}_{label}_{date.today().isoformat()}"
    (out_dir / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out_dir / f"{stem}.md").write_text(table + "\n")
    if args.split != "test":
        (out_dir / f"{stem}_misses.json").write_text(json.dumps(
            [o for o in out if o["full"] or not all(o["kept"].values())], indent=2))
    print(f"\nwrote eval/results/{stem}.*", file=sys.stderr)


if __name__ == "__main__":
    main()
