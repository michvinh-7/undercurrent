"""40 hubs, one per level, each linked only to the level above and the level below, the way
the tunnels connect. Does sync still lose nothing, duplicate nothing and agree when the
Directorate cuts the deep levels off, and what does each sync round cost on the wire?

    hub/.venv/bin/python eval/run_mesh.py                 # both modes, writes eval/results/mesh_<date>.*
    hub/.venv/bin/python eval/run_mesh.py --hubs 10 --history 5 --cut-rounds 10   # quick

The hubs are the real code (EventLog, Gate, Syncer, Link) in one process, each with its own
SQLite file; only the network between them is simulated:
- one round = one sync tick on every hub (1 s at the default SYNC_INTERVAL_S)
- an event moves at most one hop per round: pushes are held until the round ends, as with
  hubs ticking at the same time, so convergence isn't flattered by tick order
- every byte that would cross the wire is counted: the question (each hub asks each
  neighbour what it holds) and the events pushed

The scenario, run twice with the same seed:
1. history: every hub posts --history signed alerts; rounds until all hubs agree
2. the cut: the link between L20 and L21 goes down; for --cut-rounds rounds, hubs on both
   sides keep posting (--per-round alerts a round, at random levels)
3. reconnect: rounds until all hubs agree again; then every alert is checked on every hub
4. quiet: --quiet rounds with nothing new, to measure the steady cost of a round

Mode "ids" asks each neighbour for its full id list (the old way); mode "summary" asks for
the per-origin summary (GET /sync/summary): a few bytes per hub, however many events.
The question's size is also measured on its own for larger logs (--sizes).
"""

import argparse
import json
import random
import sys
import tempfile
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))
RESULTS = ROOT / "eval" / "results"

from app import crypto  # noqa: E402
from app.gate import Gate  # noqa: E402
from app.link import Link  # noqa: E402
from app.log import EventLog, compute_hash  # noqa: E402
from app.models import Event, EventIn  # noqa: E402
from app.roster import Roster  # noqa: E402
from app.sync import NotSupported, Syncer  # noqa: E402


def hub_id(level: int) -> str:
    return f"hub-L{level:02d}"


class Net:
    """The wire between hubs: blocked pairs, one hop per round, and a byte count."""

    def __init__(self, mode: str):
        self.mode = mode
        self.hubs: dict[str, Syncer] = {}
        self.blocked: set[frozenset] = set()
        self.pending: list[tuple[str, list]] = []
        self.question_bytes = 0
        self.event_bytes = 0

    def flush(self) -> None:
        """End of round: pushes land."""
        pending, self.pending = self.pending, []
        for peer, events in pending:
            self.hubs[peer].receive(events)


class Wire:
    """One hub's view of the network (so a blocked pair can refuse it)."""

    def __init__(self, net: Net, me: str):
        self.net, self.me = net, me

    def _peer(self, peer: str) -> Syncer:
        if frozenset((self.me, peer)) in self.net.blocked:
            raise ConnectionError(f"{self.me} -> {peer}: cut")
        return self.net.hubs[peer]

    def summary(self, peer, mine=None):
        if self.net.mode == "ids":
            raise NotSupported(peer)
        log = self._peer(peer).log
        fp = log.fingerprint()
        body = ({"hub_id": peer, "same": True, "fingerprint": fp} if mine == fp
                else {"hub_id": peer, "origins": log.summary(), "fingerprint": fp})
        self.net.question_bytes += len(json.dumps(body)) + len(f"?unless={mine}")
        return (None if body.get("same") else body["origins"]), fp

    def ids(self, peer):
        log = self._peer(peer).log
        body = {"hub_id": peer, "ids": log.ids(), "fingerprint": log.fingerprint()}
        self.net.question_bytes += len(json.dumps(body))
        return set(body["ids"]), body["fingerprint"]

    def push(self, peer, events):
        self._peer(peer)
        self.net.event_bytes += len(json.dumps([e.model_dump(mode="json") for e in events]))
        self.net.pending.append((peer, events))
        return {}


class Mesh:
    def __init__(self, folder: Path, mode: str, levels: int, rng: random.Random):
        self.rng, self.levels = rng, levels
        self.net = Net(mode)
        self.keys = {lv: crypto.new_key() for lv in range(1, levels + 1)}  # each level's Canary box
        roster = [{"pub": crypto.public_key(k), "role": "member"} for k in self.keys.values()]
        self.hubs: dict[int, Syncer] = {}
        for lv in range(1, levels + 1):
            log = EventLog(str(folder / f"{mode}-{lv}.db"), hub_id(lv))
            gate = Gate(log, Roster(roster), hub_id(lv), require_signed=True)
            peers = [hub_id(n) for n in (lv - 1, lv + 1) if 1 <= n <= levels]
            s = Syncer(log, gate, Link(), peers, Wire(self.net, hub_id(lv)))
            self.net.hubs[hub_id(lv)] = s
            self.hubs[lv] = s
        self.posted: list[str] = []

    def post(self, level: int) -> None:
        fields = {
            "id": str(uuid.UUID(int=self.rng.getrandbits(128))), "type": "hazard", "hub_id": hub_id(level),
            "level": level, "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "author": f"canary-{level}", "source": "sensor", "device_id": f"canary-{level}",
            "payload": {"kind": self.rng.choice(["flooding", "bad_air", "bad_water", "heat"]), "severity": "high"},
        }
        self.hubs[level].gate.admit(EventIn(**crypto.sign(fields, self.keys[level])))
        self.posted.append(fields["id"])

    def round(self) -> None:
        for s in self.hubs.values():
            s.tick()
        self.net.flush()

    def agree(self, levels=None) -> bool:
        fps = {self.hubs[lv].log.fingerprint() for lv in (levels or self.hubs)}
        return len(fps) == 1

    def rounds_until_agree(self, limit: int = 1000) -> int:
        for n in range(1, limit + 1):
            self.round()
            if self.agree():
                return n
        raise RuntimeError(f"no agreement after {limit} rounds")

    def bytes(self) -> tuple[int, int]:
        return self.net.question_bytes, self.net.event_bytes


def scenario(mode: str, args, folder: Path) -> dict:
    rng = random.Random(args.seed)
    m = Mesh(folder, mode, args.hubs, rng)
    t0 = time.perf_counter()
    cut_at = args.hubs // 2

    for lv in range(1, args.hubs + 1):
        for _ in range(args.history):
            m.post(lv)
    q0, e0 = m.bytes()
    history_rounds = m.rounds_until_agree()
    q1, e1 = m.bytes()

    # The Directorate cuts the deep levels off, and both sides keep posting.
    m.net.blocked.add(frozenset((hub_id(cut_at), hub_id(cut_at + 1))))
    during = []
    for _ in range(args.cut_rounds):
        for _ in range(args.per_round):
            lv = rng.randint(1, args.hubs)
            m.post(lv)
            during.append(lv)
        m.round()
    for _ in range(args.hubs):  # let each side settle on its own
        m.round()
    shallow, deep = range(1, cut_at + 1), range(cut_at + 1, args.hubs + 1)
    sides_agree = m.agree(shallow) and m.agree(deep)
    deep_ids = {e.id for e in m.hubs[args.hubs].log.list()}
    shallow_ids = {e.id for e in m.hubs[1].log.list()}
    posted_during_deep = {i for i in deep_ids if i not in shallow_ids}
    q2, e2 = m.bytes()

    # Reconnect.
    m.net.blocked.clear()
    heal_rounds = m.rounds_until_agree()
    q3, e3 = m.bytes()

    # Every alert on every hub, once; chains intact; nothing refused.
    posted = set(m.posted)
    lost = sum(len(posted - set(s.log.ids())) for s in m.hubs.values())
    dupes = sum(s.log.count() - len(set(s.log.ids())) for s in m.hubs.values())
    intact = all(s.log.verify_report()["chain_intact"] and not s.log.verify_report()["gaps"] for s in m.hubs.values())
    refused = sum(s.log.rejected(limit=1)[0] for s in m.hubs.values())

    # Quiet rounds: the steady cost of keeping 40 hubs in agreement.
    for _ in range(args.quiet):
        m.round()
    q4, e4 = m.bytes()

    return {
        "mode": mode, "hubs": args.hubs, "links": 2 * (args.hubs - 1), "events": len(posted),
        "history_events": args.hubs * args.history, "alerts_during_cut": len(during),
        "rounds_to_agree_history": history_rounds,
        "sides_agree_during_cut": sides_agree, "deep_only_alerts_held_back": len(posted_during_deep),
        "rounds_to_agree_after_reconnect": heal_rounds,
        "lost": lost, "duplicated": dupes, "chains_intact": intact, "refused": refused,
        "bytes": {
            "history": {"question": q1 - q0, "events": e1 - e0},
            "cut": {"question": q2 - q1, "events": e2 - e1},
            "reconnect": {"question": q3 - q2, "events": e3 - e2},
            "quiet_per_round": {"question": (q4 - q3) / args.quiet, "events": (e4 - e3) / args.quiet},
            "total": q4 + e4,
        },
        "seconds": round(time.perf_counter() - t0, 1),
    }


def question_sizes(sizes: list[int], origins: int, folder: Path) -> list[dict]:
    """How big the question one hub asks one neighbour is, for a hub holding N events from
    `origins` hubs: the id list vs the summary. Same events, measured as sent."""
    out = []
    keys = {o: crypto.new_key() for o in range(1, origins + 1)}
    for n in sizes:
        log = EventLog(str(folder / f"size-{n}.db"), hub_id(1))
        per = n // origins
        for o in range(1, origins + 1):
            prev = "0" * 64
            for i in range(per):
                fields = {"id": str(uuid.uuid4()), "type": "hazard", "hub_id": hub_id(o), "level": o,
                          "created_at": "2087-03-14T02:00:00.000Z", "author": f"canary-{o}", "source": "sensor",
                          "device_id": f"canary-{o}", "payload": {"kind": "heat", "severity": "low"}}
                signed = crypto.sign(fields, keys[o])
                h = compute_hash(signed, prev)
                log.insert_synced(Event(**signed, prev_hash=prev, hash=h, priority=None))
                prev = h
        ids = len(json.dumps({"hub_id": hub_id(2), "ids": log.ids(), "fingerprint": log.fingerprint()}))
        summ = len(json.dumps({"hub_id": hub_id(2), "origins": log.summary(), "fingerprint": log.fingerprint()}))
        out.append({"events": per * origins, "ids_bytes": ids, "summary_bytes": summ})
    return out


def kb(n: float) -> str:
    return f"{n / 1024:,.1f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:,.2f} MB"


def report_md(out: dict) -> str:
    a, b = out["runs"]["ids"], out["runs"]["summary"]
    rows = [
        ("Hubs (one per level) · links", f"{a['hubs']} · {a['links']} one-way", f"{b['hubs']} · {b['links']} one-way"),
        ("Alerts posted (history + during the cut)", f"{a['history_events']} + {a['alerts_during_cut']}", f"{b['history_events']} + {b['alerts_during_cut']}"),
        ("Rounds until all hubs agree (history)", a["rounds_to_agree_history"], b["rounds_to_agree_history"]),
        ("Each side agrees while cut off", a["sides_agree_during_cut"], b["sides_agree_during_cut"]),
        ("Rounds until all hubs agree after reconnecting", a["rounds_to_agree_after_reconnect"], b["rounds_to_agree_after_reconnect"]),
        ("Alerts lost, across all hubs", a["lost"], b["lost"]),
        ("Alerts stored twice", a["duplicated"], b["duplicated"]),
        ("Every chain intact, no gaps", a["chains_intact"], b["chains_intact"]),
        ("Asking what neighbours hold, per quiet round", kb(a["bytes"]["quiet_per_round"]["question"]), kb(b["bytes"]["quiet_per_round"]["question"])),
        ("Events sent, per quiet round", kb(a["bytes"]["quiet_per_round"]["events"]), kb(b["bytes"]["quiet_per_round"]["events"])),
        ("Everything on the wire, whole scenario", kb(a["bytes"]["total"]), kb(b["bytes"]["total"])),
    ]
    lines = [
        f"## Sync across {a['hubs']} hubs, one per level ({out['date']})",
        "",
        f"Each hub linked only to the levels above and below. The link between L{a['hubs'] // 2} and L{a['hubs'] // 2 + 1} "
        f"is cut for {out['args']['cut_rounds']} rounds while both sides keep posting, then restored. Real hub code in one process; "
        "the network is simulated, one hop per round (1 s at the default sync interval). Same seed for both modes. "
        "`eval/run_mesh.py`.",
        "",
        "| | Full id list (before) | Per-origin summary (now) |",
        "|---|---|---|",
        *[f"| {r[0]} | {r[1]} | {r[2]} |" for r in rows],
        "",
        f"**The question one hub asks one neighbour each round, by log size** ({out['args']['origins']} origin hubs):",
        "",
        "| Events held | Full id list | Summary |",
        "|---|---|---|",
        *[f"| {r['events']:,} | {kb(r['ids_bytes'])} | {kb(r['summary_bytes'])} |" for r in out["question_sizes"]],
        "",
        f"Each round, every hub asks each neighbour once: {a['links']} questions a round across the mesh.",
        "",
    ]
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hubs", type=int, default=40)
    ap.add_argument("--history", type=int, default=25, help="alerts each hub posts first")
    ap.add_argument("--cut-rounds", type=int, default=30)
    ap.add_argument("--per-round", type=int, default=4, help="alerts posted each round during the cut")
    ap.add_argument("--quiet", type=int, default=5)
    ap.add_argument("--sizes", default="1000,10000,100000", help="log sizes for the question-size table")
    ap.add_argument("--origins", type=int, default=40)
    ap.add_argument("--seed", type=int, default=2087)
    ap.add_argument("--out", default=str(RESULTS))
    args = ap.parse_args(argv)

    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        runs = {}
        for mode in ("ids", "summary"):
            runs[mode] = scenario(mode, args, folder)
            r = runs[mode]
            print(f"{mode}: agree after reconnect in {r['rounds_to_agree_after_reconnect']} rounds, lost {r['lost']}, "
                  f"duplicated {r['duplicated']}, quiet round {kb(r['bytes']['quiet_per_round']['question'])} asked, "
                  f"{r['seconds']} s", flush=True)
        sizes = question_sizes([int(s) for s in args.sizes.split(",")], args.origins, folder)
    out = {"date": date.today().isoformat(), "args": vars(args), "runs": runs, "question_sizes": sizes}
    dest = Path(args.out)
    dest.mkdir(parents=True, exist_ok=True)
    stem = dest / f"mesh_{out['date']}"
    stem.with_suffix(".json").write_text(json.dumps(out, indent=1))
    stem.with_suffix(".md").write_text(report_md(out))
    print(report_md(out))
    ok = all(r["lost"] == 0 and r["duplicated"] == 0 and r["chains_intact"] and r["sides_agree_during_cut"] for r in runs.values())
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
