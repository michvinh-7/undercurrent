"""Page through messages_labeled.jsonl and accept or fix each label.

    python eval/review_labels.py                    # unreviewed messages only
    python eval/review_labels.py --split dev        # only the tuning set
    python eval/review_labels.py --label urgent     # only one label
    python eval/review_labels.py --all              # everything
    python eval/review_labels.py --no-rules         # hide the rules above each page
    python eval/review_labels.py --no-clear         # scroll instead of redrawing the screen

Default: one message at a time, with the labeling rules from eval/README.md
shown on every screen. Use --page 10 for the older ten-at-a-time pages.

One message at a time:
    Enter                           label and facts are both correct
    1 / 2 / 3 / 4                   change label to sos / urgent / routine / fake
    level=31 people_count=2         fix facts (none clears: level=none)
    u  b  s  ?  q                   undo, back, skip, full rules, save and quit

Page mode (--page N). At each page:
    Enter                           accept every row on the page
    3 label=urgent people_count=3   fix row 3 (use none to clear: 3 level=none)
    u                               undo the last fix on this page
    b                               go back to the previous page
    s                               skip this page for now
    ?                               full rules (fields, hazard list)
    q                               save and quit
Saves after every change, so quitting anytime is safe.

Judge each label from the message text and the rules on screen only. Do not
open eval/results/*_misses.json while reviewing: it would make the test set
an unfair test.
"""

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from collections import Counter
from pathlib import Path

PATH = Path(__file__).resolve().parent / "messages_labeled.jsonl"
FIELDS = {"label": str, "type": str, "level": int, "injuries": int, "people_count": int, "hazard": str, "split": str}
CHOICES = {
    "label": {"sos", "urgent", "routine", "fake"},
    "type": {"checkin", "hazard", "case", "missing_person"},
    "hazard": {"flooding", "bad_air", "bad_water", "heat", "blackout", "collapse", "other", None},
    "split": {"dev", "test"},
}

# Wording copied from eval/README.md ("Labeling conventions"). Change it there first.
LABEL_RULES = {
    "sos": "life in danger right now",
    "urgent": "needs help soon",
    "routine": "status only",
    "fake": "spam, rumor, propaganda or impossible claims",
}
FACT_KEYS = ("type", "level", "people_count", "injuries", "hazard")
LABEL_COLOR = {"sos": "1;31", "urgent": "1;33", "routine": "1;32", "fake": "1;35"}

USE_COLOR = (sys.stdout.isatty() and "NO_COLOR" not in os.environ) or bool(os.environ.get("FORCE_COLOR"))
CLEAR = sys.stdout.isatty()  # redraw one page at a time instead of scrolling


def paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def dim(text: str) -> str:
    return paint("2", text)


def rules_block() -> str:
    lines = [paint(LABEL_COLOR[k], f" {k:<8}") + f" {v}" for k, v in LABEL_RULES.items()]
    lines.append(dim(" facts (level, people_count, injuries): only if the message states them"))
    return "\n".join(lines)


FULL_RULES = """\
Fields you can fix:  label, type, level, people_count, injuries, hazard
  hazard  flooding | bad_air | bad_water | heat | blackout | collapse | other | none
  type    checkin | hazard | case | missing_person
  empty   use none, e.g.  3 level=none
Judge from the message text and these rules only. Do not open eval/results/*_misses.json.
"""


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


LABEL_ORDER = {"sos": 0, "urgent": 1, "routine": 2, "fake": 3}


def show_page(page, label, start, total, done, all_total, rules=True, note=""):
    if CLEAR:
        print("\033[2J\033[H", end="")
    cols = max(60, min(shutil.get_terminal_size().columns, 110))
    print(paint("1", f"Page {start + 1}-{start + len(page)} of {total}") + dim(f"   {done}/{all_total} reviewed overall"))
    if rules:
        print(rules_block())
    print(dim("-" * min(cols, 78)))
    print(
        paint(LABEL_COLOR.get(label, "1"), f"{label.upper()} page") + f": is every row really \"{LABEL_RULES.get(label, '?')}\"?\n"
    )
    for i, r in enumerate(page, 1):
        changed = f"[now {r['label']}] " if r["label"] != label else ""
        body = textwrap.fill(
            changed + r["text"], width=cols - 5, initial_indent="", subsequent_indent="    "
        ).replace("\n", "\n")
        print(f"{paint('1', f'{i:>2}')}  {body}")
        # Only facts that are filled in; anything missing here means the label says "not stated".
        facts = "  ".join(f"{k}={r[k]}" for k in FACT_KEYS if r[k] is not None) or "no facts filled in"
        print(dim(f"    {facts}   {r['id']}"))
        print()
    if note:
        print(paint("1;33", note) + "\n")
    print(dim("Enter accept page | N label=urgent fix row N | u undo | b back | s skip | ? full rules | q quit"))


NUM_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "twenty", "dozen",
}
LABEL_KEYS = {"1": "sos", "2": "urgent", "3": "routine", "4": "fake"}


def numbers_in(text: str) -> list[str]:
    """Numbers written in the message, as a reading aid for checking level / people_count / injuries."""
    found = re.findall(r"\d+", text)
    found += [w for w in re.findall(r"[a-z]+", text.lower()) if w in NUM_WORDS]
    return found


def show_card(row, orig_label, pos, group_total, idx, total, done, all_total, rules=True, note=""):
    if CLEAR:
        print("\033[2J\033[H", end="")
    cols = max(60, min(shutil.get_terminal_size().columns, 100))
    print(paint("1", f"Message {idx + 1} of {total}") + dim(f"   {done}/{all_total} reviewed overall"))
    if rules:
        print(rules_block())
    print(dim("-" * min(cols, 78)))
    print(paint("1", f"{orig_label.upper()} group, {pos} of {group_total}") + dim("   (labels are grouped so the odd one out stands out)"))
    print()
    print(textwrap.fill(row["text"], width=cols - 4, initial_indent="  ", subsequent_indent="  "))
    print()
    nums = numbers_in(row["text"])
    print(dim("  numbers written in the message: " + (", ".join(nums) if nums else "none")))
    print()
    label = row["label"]
    print(paint(LABEL_COLOR.get(label, "1"), f"  label         {label.upper()}") + f"   = {LABEL_RULES.get(label, '?')}")
    for k in FACT_KEYS:
        print(f"  {k:<13} {'-' if row[k] is None else row[k]}")
    if row.get("reviewed"):
        print(dim("  (already marked reviewed)"))
    print()
    if note:
        print(paint("1;33", note) + "\n")
    print(dim("  Enter            everything above is correct"))
    print(dim("  1 sos  2 urgent  3 routine  4 fake     change the label"))
    print(dim("  level=31 people_count=2                fix facts (none clears one)"))
    print(dim("  u undo   b back   s skip   ? rules   q quit"))


def card_mode(rows, todo, args):
    """One message at a time: judge the label, then check the facts against the message."""
    orig = {}
    seen = Counter()
    for r in todo:
        seen[r["label"]] += 1
        orig[r["id"]] = (r["label"], seen[r["label"]])
    group_total = Counter(r["label"] for r in todo)
    done_count = lambda: sum(bool(r.get("reviewed")) for r in rows)
    i, undo, note = 0, [], ""
    while i < len(todo):
        row = todo[i]
        label0, pos = orig[row["id"]]
        show_card(row, label0, pos, group_total[label0], i, len(todo), done_count(), len(rows),
                  rules=not args.no_rules, note=note)
        note = ""
        cmd = input("> ").strip()
        if cmd == "q":
            save(rows)
            return
        if cmd == "":
            row["reviewed"] = True
            save(rows)
            i += 1
        elif cmd == "s":
            i += 1
        elif cmd == "b":
            if i == 0:
                note = "! this is the first message"
            else:
                i -= 1
        elif cmd == "u":
            if not undo:
                note = "! nothing to undo"
            else:
                changed, old = undo.pop()
                changed.clear()
                changed.update(old)
                save(rows)
                i = todo.index(changed)
                note = "undone"
        elif cmd == "?":
            print("\n" + FULL_RULES)
            input("Press Enter to go back to the message ")
        else:
            try:
                changes = {"label": LABEL_KEYS[cmd]} if cmd in LABEL_KEYS else parse(cmd)
            except ValueError as e:
                note = f"! {e}"
                continue
            undo.append((row, dict(row)))
            row.update(changes)
            save(rows)
            note = "saved. Press Enter to confirm this message, or keep fixing."
    if CLEAR:
        print("\033[2J\033[H", end="")
    print(f"All reviewed ({done_count()}/{len(rows)}).")


def main():
    global CLEAR
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="include already-reviewed messages")
    ap.add_argument("--split", choices=["dev", "test"], help="only this split")
    ap.add_argument("--label", choices=sorted(LABEL_ORDER), help="only this label")
    ap.add_argument("--page", type=int, default=1, help="messages per screen; 1 = one message at a time (default), 10 = old page mode")
    ap.add_argument("--no-rules", action="store_true", help="hide the rules above each page")
    ap.add_argument("--no-clear", action="store_true", help="scroll instead of redrawing the screen each page")
    args = ap.parse_args()
    if args.no_clear:
        CLEAR = False

    rows = [json.loads(line) for line in PATH.open()]
    todo = [
        r for r in rows
        if (args.all or not r.get("reviewed"))
        and (not args.split or r["split"] == args.split)
        and (not args.label or r["label"] == args.label)
    ]
    # Group by label so each page is one kind: easier to spot the odd one out.
    todo.sort(key=lambda r: (LABEL_ORDER.get(r["label"], 9), r["id"]))

    if args.page <= 1:
        card_mode(rows, todo, args)
        return

    def done_count():
        return sum(bool(r.get("reviewed")) for r in rows)

    start = 0
    trail = []  # (start, page, label) of every page already passed, so 'b' can return to it exactly
    page = None
    page_label = None
    note = ""
    while start < len(todo):
        if page is None:
            # Pages never mix labels, so a page reads as "are all of these really SOS?"
            page = todo[start:start + args.page]
            page = [r for r in page if r["label"] == page[0]["label"]]
            page_label = page[0]["label"]  # fixed for the page, even if a row's label is changed
        undo = []  # (row, copy of row before the fix) for fixes made on this page
        going_back = False
        while True:
            show_page(page, page_label, start, len(todo), done_count(), len(rows), rules=not args.no_rules, note=note)
            note = ""
            cmd = input("> ").strip()
            if cmd == "q":
                save(rows)
                return
            if cmd == "s":
                break
            if cmd == "?":
                print("\n" + FULL_RULES)
                input("Press Enter to go back to the page ")
                continue
            if cmd == "b":
                if not trail:
                    note = "! this is the first page"
                    continue
                going_back = True
                break
            if cmd == "u":
                if not undo:
                    note = "! nothing to undo on this page"
                    continue
                row, old = undo.pop()
                row.clear()
                row.update(old)
                save(rows)
                note = "undone"
                continue
            if not cmd:
                for r in page:
                    r["reviewed"] = True
                save(rows)
                break
            num, _, rest = cmd.partition(" ")
            try:
                if not num.isdigit() or not 1 <= int(num) <= len(page):
                    raise ValueError(f"start with a row number 1-{len(page)}, e.g. '3 label=urgent'")
                row = page[int(num) - 1]
                old = dict(row)
                row.update(parse(rest))
            except ValueError as e:
                note = f"! {e}"
                continue
            undo.append((row, old))
            save(rows)  # fix saved; page shown again so you can fix more or press Enter
            note = f"saved row {num}"
        if going_back:
            start, page, page_label = trail.pop()
        else:
            trail.append((start, page, page_label))
            start += len(page)
            page = None
    if CLEAR:
        print("\033[2J\033[H", end="")
    print(f"All reviewed ({done_count()}/{len(rows)}).")


if __name__ == "__main__":
    main()
