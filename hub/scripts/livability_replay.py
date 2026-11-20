"""The Livability Index over time: a simulated night, scored by the hub's own code.

Six hours of signed events on four levels (the deep levels' fan stalls and floods, a bad
water report, a sagging relay, illness reports, Have / Need posts, check-ins), built
deterministically: the same keys, ids and times every run. The hub's real `livability()`
scores them every 5 minutes, seeing only the events signed by then, exactly as a hub
answering GET /livability at that moment would. The frames go to the web app, which plays
them back at any speed (/overview, "The index over time").

    cd hub
    .venv/bin/python scripts/livability_replay.py            # rewrite the frames
    .venv/bin/python scripts/livability_replay.py --check    # exit 1 if the frames are stale

Nothing here is real or reaches a hub: it's labelled simulated wherever it's shown. Rerun it
after changing app/livability.py (tests/test_livability_replay.py fails until you do).
"""

import argparse
import hashlib
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HUB))

from nacl.signing import SigningKey  # noqa: E402

from app import crypto  # noqa: E402
from app.livability import livability  # noqa: E402
from app.models import EventIn  # noqa: E402

OUT = HUB.parent / "web" / "app" / "overview" / "livability-replay.json"
START = datetime(2087, 3, 14, 2, 0, tzinfo=timezone.utc)
HOURS = 6
STEP_MIN = 5
LEVELS = (34, 35, 12, 1)
HUB_OF = {34: "hub-L34", 35: "hub-L34", 12: "hub-L12", 1: "hub-L12"}
NS = uuid.UUID("6f1c2a52-6b8e-4d1e-9b39-2087031402aa")


def key(name: str) -> SigningKey:
    """The same key for the same sender every run, so the frames are reproducible."""
    return SigningKey(hashlib.sha256(f"undercurrent-livability-replay:{name}".encode()).digest())


def lerp(a: float, b: float, t0: int, t1: int, t: int) -> float:
    if t <= t0:
        return a
    if t >= t1:
        return b
    return a + (b - a) * (t - t0) / (t1 - t0)


class Night:
    def __init__(self):
        self.events: list[EventIn] = []
        self.moments: list[dict] = []

    def add(self, minute: int, level: int, type: str, payload: dict, sender: str, sensor: bool = False):
        k = key(sender)
        fields = {
            "id": str(uuid.uuid5(NS, f"{len(self.events)}:{sender}:{minute}")),
            "type": type, "hub_id": HUB_OF[level], "level": level,
            "created_at": (START + timedelta(minutes=minute)).isoformat().replace("+00:00", "Z"),
            "author": sender, "payload": {**payload, "simulated": True},
            "source": "sensor" if sensor else "resident", "device_id": sender if sensor else None,
        }
        self.events.append(EventIn(**crypto.sign(fields, k)))

    def reading(self, minute: int, level: int, box: str, kind: str, value: float, unit: str):
        self.add(minute, level, "hazard", {"kind": kind, "severity": "low",
                                           "reading": {"value": round(value, 1), "unit": unit}}, box, sensor=True)

    def moment(self, minute: int, level: int, text: str):
        self.moments.append({"t": minute, "level": level, "text": text})


def build() -> Night:
    n = Night()
    end = HOURS * 60

    # Last evening's check-ins (inside the 6-hour window from the start) and this morning's.
    # (level, people, hours slept, mood, days of food at home)
    for level, people, sleep, mood, food in ((34, 3, 6, 3, 5), (35, 2, 7, 4, 5), (12, 3, 7, 4, 7)):
        for i in range(people):
            n.add(-50 + 5 * i, level, "checkin", {"status": "ok", "sleep_h": sleep, "mood": mood, "food_days": food}, f"resident-{level}-{i}")
    for level, people, sleep, mood, food in ((34, 3, 5, 2, 5), (35, 2, 5, 3, 2), (12, 3, 7, 4, 7)):
        for i in range(people):
            n.add(330 + 4 * i, level, "checkin", {"status": "ok", "sleep_h": sleep, "mood": mood, "food_days": food}, f"resident-{level}-{i}")
    n.moment(330, 34, "Morning check-ins: 34 and 35 slept 5 hours, mood low")
    n.moment(334, 35, "35's check-ins: the flood spoiled stores, 2 days of food left")

    for m in range(-10, end + 1, 10):  # from 01:50, so the first frame already has every box
        # Level 34: the fan stalls at 02:40, CO2 climbs; repaired at 06:00.
        co2 = lerp(950, 2400, 40, 120, m) if m < 240 else lerp(2400, 900, 240, 290, m)
        heat = lerp(30, 34, 40, 120, m) if m < 240 else lerp(34, 30, 240, 300, m)
        n.reading(m, 34, "canary-34", "bad_air", co2, "ppm CO₂")
        n.reading(m + 1, 34, "canary-34", "heat", heat, "°C")
        # Level 34's relay sags from 03:30 until the crew swaps it at 05:20.
        volts = 228 if m < 90 else lerp(228, 194, 90, 190, m) if m < 200 else 230
        n.reading(m + 2, 34, "relay-34", "blackout", volts, "V")
        # Level 35: water on the probe from 03:00, 12 cm by 04:30; pumps from 05:00.
        cm = 0 if m < 60 else lerp(0, 12, 60, 150, m) if m < 180 else lerp(12, 1, 180, 240, m)
        n.reading(m + 3, 35, "canary-35", "flooding", cm, "cm")
        n.reading(m + 4, 35, "canary-35", "heat", 29, "°C")
        # Level 12 and the surface: steady.
        n.reading(m + 5, 12, "canary-12", "heat", 24, "°C")
        n.reading(m + 6, 1, "canary-surface", "bad_air", 450, "ppm CO₂")
        n.reading(m + 7, 1, "canary-surface", "heat", 18, "°C")

    n.moment(40, 34, "Fan stalls: CO₂ starts to climb")
    n.moment(60, 35, "Water reaches the probe")
    n.moment(90, 34, "Relay voltage starts to sag")
    n.moment(120, 34, "CO₂ at 2,400 ppm: one unsafe dimension caps the level")
    n.moment(185, 34, "Blackout forecast: the relay drops out in ~51 min")
    n.moment(200, 34, "Crew swaps the relay: power back to 230 V")
    n.moment(180, 35, "Pumps restart")
    n.moment(240, 34, "Fan repaired: CO₂ falls")

    # Level 12: the recycler fails. Two residents report bad water, then the repair.
    n.add(80, 12, "hazard", {"kind": "bad_water", "severity": "high", "note": "tap water brown, smells of sewage"}, "resident-12-0")
    n.add(100, 12, "hazard", {"kind": "bad_water", "severity": "high", "note": "same on the east side"}, "resident-12-1")
    n.add(180, 12, "hazard", {"kind": "bad_water", "severity": "low", "note": "recycler back on, water clearing"}, "resident-12-2")
    n.moment(80, 12, "Residents report brown tap water (high)")
    n.moment(180, 12, "Recycler back on (low)")
    n.add(130, 12, "case", {"symptoms": ["stomach cramps", "vomiting"], "people_affected": 2}, "resident-12-1")
    n.moment(130, 12, "2 people sick after drinking it")
    n.add(110, 12, "exchange", {"side": "need", "category": "medicine", "item": "rehydration salts", "quantity": 2}, "resident-12-0")
    n.add(160, 1, "exchange", {"side": "have", "category": "medicine", "item": "rehydration salts", "quantity": 4}, "resident-1-0")
    n.moment(160, 1, "The surface level posts rehydration salts: 12's need is met")

    # Level 34: the bad air makes people ill.
    n.add(130, 34, "case", {"symptoms": ["headache", "dizzy"], "people_affected": 3}, "resident-34-1")
    n.add(170, 34, "case", {"symptoms": ["shortness of breath"], "people_affected": 2}, "resident-34-2")

    # Level 35: a resident standing in water, then sewage backs up after the flood.
    n.add(120, 35, "hazard", {"kind": "flooding", "severity": "high", "note": "water past the ankles in the lower gallery"}, "resident-35-0")
    n.add(250, 35, "hazard", {"kind": "flooding", "severity": "low", "note": "mostly drained"}, "resident-35-1")
    n.add(210, 35, "hazard", {"kind": "bad_water", "severity": "medium", "note": "sewage smell from the drains"}, "resident-35-1")
    n.add(220, 35, "exchange", {"side": "need", "category": "water", "item": "drinking water", "quantity": 10}, "resident-35-0")
    n.add(260, 35, "exchange", {"side": "need", "category": "food", "item": "dry food for 4 days, family of 5", "quantity": 1}, "resident-35-1")
    n.moment(260, 35, "A family on 35 asks for food: unmet")
    n.moment(120, 35, "Resident: water past the ankles (high)")
    n.moment(210, 35, "Sewage backs up after the flood")
    n.events.sort(key=lambda e: e.created_at)
    n.moments.sort(key=lambda m: (m["t"], m["level"]))
    return n


def frames(n: Night) -> list[dict]:
    out = []
    for m in range(0, HOURS * 60 + 1, STEP_MIN):
        now = (START + timedelta(minutes=m)).timestamp()
        seen = [e for e in n.events if datetime.fromisoformat(e.created_at.replace("Z", "+00:00")).timestamp() <= now]
        r = livability(seen, window_h=6, now=now)
        levels = {}
        for lv in r["levels"]:
            levels[str(lv["level"])] = {
                "score": lv["score"], "band": lv["band"], "capped": lv["capped"],
                "by": lv["limited_by"], "why": lv["limited_why"], "coverage": lv["coverage"],
                "dims": {d: v["score"] for d, v in lv["dimensions"].items()},
            }
        out.append({"t": m, "events": len(seen), "levels": levels})
    return out


def render() -> str:
    n = build()
    fr = frames(n)
    data = {
        "simulated": True,
        "about": "A simulated night of signed events, scored every 5 minutes by hub/app/livability.py. "
                 "Made by hub/scripts/livability_replay.py.",
        "start": START.isoformat().replace("+00:00", "Z"), "hours": HOURS, "step_min": STEP_MIN,
        "levels": list(LEVELS), "event_count": fr[-1]["events"],
        "moments": n.moments, "frames": fr,
    }
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if the saved frames don't match the scoring code")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    text = render()
    out = Path(args.out)
    if args.check:
        same = out.exists() and out.read_text() == text
        print("frames are current" if same else f"{out} is stale: run hub/scripts/livability_replay.py")
        return 0 if same else 1
    out.write_text(text)
    print(f"wrote {out} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
