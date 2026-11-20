"""The Have / Need board (app/exchange.py): what's open, who can close a post, and the matches."""

from types import SimpleNamespace

from app.exchange import board, exchange_priority
from app.ingest import score
from app.models import EventIn

T0 = 1_800_003_600  # a fixed "now": 2027-01-15 09:00 UTC, after every post below


def post(id, side, category, item, level, pub, minutes_ago=0, **extra):
    return SimpleNamespace(
        id=id, type="exchange", level=level, hub_id="hub-L12", author=f"anon-{pub}", author_pub=pub, sig="s",
        created_at=f"2027-01-15T08:{59 - minutes_ago:02d}:00+00:00",
        payload={"side": side, "category": category, "item": item, **extra},
    )


def close(id, target, pub):
    return SimpleNamespace(id=id, type="exchange", level=12, hub_id="hub-L12", author=f"anon-{pub}", author_pub=pub,
                           sig="s", created_at="2027-01-15T09:00:00+00:00", payload={"closes": target})


def ids(rows):
    return [r["id"] for r in rows]


def test_a_need_is_matched_to_the_nearest_offer_in_its_category():
    b = board([
        post("n1", "need", "medicine", "rehydration salts", 34, "a"),
        post("h-far", "have", "medicine", "bandages", 2, "b"),
        post("h-near", "have", "medicine", "bandages", 31, "c"),
        post("h-food", "have", "food", "rice", 34, "d"),
    ], now=T0)
    assert [(m["need_id"], m["have_id"], m["levels_apart"]) for m in b["matches"]] == [("n1", "h-near", 3)]


def test_the_same_item_named_beats_a_closer_level():
    b = board([
        post("n1", "need", "medicine", "rehydration salts for 2 kids", 34, "a"),
        post("h1", "have", "medicine", "bandages", 34, "b"),
        post("h2", "have", "medicine", "box of rehydration salts", 12, "c"),
    ], now=T0)
    assert b["matches"][0]["have_id"] == "h2"


def test_fair_order_medicine_first_then_longest_waiting():
    # one offer of each kind, two needs competing for the food offer: the older one wins
    b = board([
        post("food-new", "need", "food", "food for 3 days", 12, "a", minutes_ago=1),
        post("food-old", "need", "food", "food for a week", 38, "b", minutes_ago=30),
        post("have-food", "have", "food", "rice", 12, "c"),
        post("med", "need", "medicine", "insulin", 35, "d"),
        post("have-med", "have", "medicine", "insulin", 12, "e"),
    ], now=T0)
    assert ids(b["needs"])[0] == "med"  # medicine first
    assert {m["need_id"]: m["have_id"] for m in b["matches"]} == {"med": "have-med", "food-old": "have-food"}
    assert b["unmet"] == ["food-new"]


def test_only_the_poster_can_close_a_post():
    events = [post("n1", "need", "space", "dry place to sleep", 35, "a"), post("h1", "have", "space", "2 beds", 12, "b")]
    assert len(board(events + [close("x", "n1", "mallory")], now=T0)["needs"]) == 1  # someone else: ignored
    b = board(events + [close("x", "n1", "a")], now=T0)
    assert b["needs"] == [] and b["matches"] == [] and b["closed"] == 1
    assert ids(b["haves"]) == ["h1"] and not b["haves"][0]["matched"]


def test_nobody_is_matched_with_their_own_offer_and_counts_per_level():
    b = board([post("n1", "need", "power", "charge a CPAP", 34, "a"), post("h1", "have", "power", "2 hours of battery", 34, "a")], now=T0)
    assert b["matches"] == [] and b["unmet"] == ["n1"]
    assert b["by_level"] == [{"level": 34, "needs": 1, "haves": 1}]


def test_board_posts_get_a_rule_priority_below_every_emergency():
    assert exchange_priority({"side": "need", "category": "medicine"}) == 0.45
    assert exchange_priority({"side": "have", "category": "food"}) == 0.15
    assert exchange_priority({"closes": "x"}) == 0.05
    e = score(EventIn(type="exchange", level=34, author="a", payload={"side": "need", "category": "water", "item": "clean water"}))
    assert e.priority == 0.42  # set by rule even with the AI off, and never by the model
