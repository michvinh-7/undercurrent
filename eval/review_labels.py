"""Page through messages_labeled.jsonl and accept or fix each label.

    python eval/review_labels.py              # unreviewed messages only
    python eval/review_labels.py --all        # everything

At each message:
    Enter                         accept as is
    label=urgent people_count=3   fix fields (use none to clear: level=none)
    s                             skip for now
    q                             save and quit
Saves after every change, so quitting anytime is safe.
"""

import argparse
import json
from pathlib import Path

PATH = Path(__file__).resolve().parent / "messages_labeled.jsonl"
FIELDS = {"label": str, "type": str, "level": int, "injuries": int, "people_count": int, "hazard": str, "split": str}
CHOICES = {
    "label": {"sos", "urgent", "routine", "fake"},
    "type": {"checkin", "hazard", "case", "missing_person"},
    "hazard": {"flooding", "bad_air", "bad_water", "heat", "blackout", "collapse", "other", None},
    "split": {"dev", "test"},
}


def save(rows):
    PATH.write_text("".join(json.dumps(r) + "\n" for r in rows))


def parse(cmd: str) -> dict:
    changes = {}
    for part in cmd.split():
        key, _, raw = part.partition("=")
        if key not in FIELDS:
            raise ValueError(f"unknown field {key!r}; fields: {', '.join(FIELDS)}")
        value = None if raw.lower() in ("none", "null", "-") else FIELDS[key](raw)
        if key in CHOICES and value not in CHOICES[key]:
            raise ValueError(f"{key} must be one of {sorted(map(str, CHOICES[key]))}")
        changes[key] = value
    return changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(line) for line in PATH.open()]
    todo = [r for r in rows if args.all or not r.get("reviewed")]
    print(f"{len(todo)} to review ({sum(r.get('reviewed', False) for r in rows)}/{len(rows)} done)\n")

    for n, r in enumerate(todo, 1):
        while True:
            print(f"[{n}/{len(todo)}] {r['id']} ({r['split']})  {r['text']}")
            print("   " + "  ".join(f"{k}={r[k]}" for k in FIELDS if k != "split"))
            cmd = input("   > ").strip()
            if cmd == "q":
                save(rows)
                return
            if cmd == "s":
                break
            try:
                r.update(parse(cmd))
            except ValueError as e:
                print(f"   ! {e}")
                continue
            r["reviewed"] = True
            save(rows)
            break
        print()
    print("All reviewed.")


if __name__ == "__main__":
    main()
