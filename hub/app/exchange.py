"""The Have / Need board (questions 2, 6, 10 and 12: share power, water, food, space and
medicine fairly when there isn't enough).

Residents post what they have spare or what they need, signed like any report, as
events of type "exchange":

    {"side": "need", "category": "medicine", "item": "rehydration salts", "quantity": 2}
    {"side": "have", "category": "space", "item": "2 spare beds", "location": "North Gallery"}

A post is closed by a later exchange event {"closes": "<post id>"} from the SAME key
(author_pub; for unsigned posts, the same author handle). Nobody can close someone
else's post, and the Directorate can't fake one: posts are signed and checked like
everything else.

board(events) works out what's still open and suggests matches: each need gets the
closest open offer in the same category, preferring one that names the same thing.
Needs are matched in a fair order, so the deep levels don't always lose:
medicine and water first, then the need that has waited longest. One offer serves one
need. Plain rules, so every match can be explained.
"""

import re
from datetime import datetime

CATEGORIES = ("medicine", "water", "food", "power", "space", "other")  # matching order: most urgent first
URGENCY = {c: i for i, c in enumerate(CATEGORIES)}


def exchange_priority(payload: dict) -> float:
    """Priority for a board post: below every emergency (an SOS is 0.9+), needs above offers."""
    if payload.get("closes"):
        return 0.05
    if payload.get("side") == "need":
        return {"medicine": 0.45, "water": 0.42, "food": 0.38, "power": 0.35}.get(payload.get("category"), 0.3)
    return 0.15


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2}


def _owner(e) -> str:
    return e.author_pub or f"handle:{e.author}"


def _age_s(e, now: float) -> float:
    try:
        return max(0.0, now - datetime.fromisoformat(e.created_at.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0.0


def post_view(e, now: float) -> dict:
    p = e.payload or {}
    return {
        "id": e.id, "side": p.get("side"), "category": p.get("category", "other"), "item": p.get("item", ""),
        "quantity": p.get("quantity"), "location": p.get("location"), "note": p.get("note"),
        "level": e.level, "hub_id": e.hub_id, "author": e.author, "author_pub": e.author_pub,
        "signed": bool(e.sig), "simulated": p.get("simulated") is True,
        "created_at": e.created_at, "waiting_s": round(_age_s(e, now)),
    }


def board(events, now: float | None = None) -> dict:
    """Open needs and offers, suggested matches, and a per-level count. `events` = any events."""
    now = now if now is not None else datetime.now().timestamp()
    ex = [e for e in events if e.type == "exchange"]
    posts = {e.id: e for e in ex if (e.payload or {}).get("side") in ("have", "need")}
    closed = set()
    for e in ex:
        target = posts.get((e.payload or {}).get("closes"))
        if target is not None and _owner(target) == _owner(e):  # only the poster can close it
            closed.add(target.id)
    open_posts = [e for e in posts.values() if e.id not in closed]
    needs = [e for e in open_posts if e.payload["side"] == "need"]
    haves = [e for e in open_posts if e.payload["side"] == "have"]

    def cat(e):
        c = (e.payload or {}).get("category")
        return c if c in URGENCY else "other"

    # fair order: most urgent category first, then whoever has waited longest
    needs.sort(key=lambda e: (URGENCY[cat(e)], -_age_s(e, now)))
    haves.sort(key=lambda e: e.created_at)
    taken, matches = set(), []
    for n in needs:
        want = _words(f"{n.payload.get('item', '')} {n.payload.get('note', '')}")
        candidates = [h for h in haves if h.id not in taken and cat(h) == cat(n) and _owner(h) != _owner(n)]
        if not candidates:
            continue
        best = min(candidates, key=lambda h: (
            0 if want & _words(f"{h.payload.get('item', '')} {h.payload.get('note', '')}") else 1,  # same thing named
            abs(h.level - n.level),  # then the nearest level
        ))
        taken.add(best.id)
        matches.append({
            "need_id": n.id, "have_id": best.id, "category": cat(n),
            "need_level": n.level, "have_level": best.level, "levels_apart": abs(best.level - n.level),
            "need_item": n.payload.get("item", ""), "have_item": best.payload.get("item", ""),
        })
    matched_needs = {m["need_id"] for m in matches}
    by_level: dict[int, dict[str, int]] = {}
    for e in open_posts:
        row = by_level.setdefault(e.level, {"needs": 0, "haves": 0})
        row["needs" if e.payload["side"] == "need" else "haves"] += 1
    return {
        "needs": [post_view(e, now) | {"matched": e.id in matched_needs} for e in needs],
        "haves": [post_view(e, now) | {"matched": e.id in taken} for e in haves],
        "matches": matches,
        "unmet": [e.id for e in needs if e.id not in matched_needs],
        "by_level": [{"level": lv, **c} for lv, c in sorted(by_level.items())],
        "closed": len(closed),
    }
