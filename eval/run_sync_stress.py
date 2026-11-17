"""Headline number 3: alerts delivered after random link cuts, with 0 duplicates.

Starts two real hubs (uvicorn, two ports) that sync with each other over a slow link,
with signing required and a temporary roster. Each round posts signed alerts with
random priorities to both hubs while randomly cutting and restoring each hub's link
(POST /link, the dashboard's "cut the network" button). Then it restores both links
and waits for the hubs to settle.

Checks, per round and at the end:
- delivered: every alert posted so far is held by BOTH hubs
- duplicates: each hub's event count equals the number of unique alerts
- both chains verify, with no gaps, and sync rejected nothing (no false forgeries)

    hub/.venv/bin/python eval/run_sync_stress.py                 # 5 rounds, 40 alerts each
    hub/.venv/bin/python eval/run_sync_stress.py --rounds 10 --bandwidth 1000

Real hubs and a real link simulation; the alerts and the cut timing are generated.
Say "simulated cuts" wherever the number is shown.
"""

import argparse
import json
import random
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from statistics import median

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hub_procs import ROOT, crypto, signed_alert, start_hub, stop, wait_up  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--alerts", type=int, default=40, help="alerts per round, split across both hubs")
    ap.add_argument("--bandwidth", type=float, default=2000, help="link bytes per second (each hub's outbound link)")
    ap.add_argument("--cut-prob", type=float, default=0.25, help="chance of a cut/restore after each alert")
    ap.add_argument("--hubs", default="hub-L34,hub-L12", help="two hub ids, comma-separated (level from the id)")
    ap.add_argument("--ports", default="8101,8102")
    ap.add_argument("--interval", type=float, default=0.2, help="sync interval, seconds")
    ap.add_argument("--settle-timeout", type=float, default=180)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    hub_ids = args.hubs.split(",")
    ports = [int(p) for p in args.ports.split(",")]
    urls = [f"http://127.0.0.1:{p}" for p in ports]
    levels = [int("".join(c for c in h if c.isdigit()) or 1) for h in hub_ids]
    keys = [crypto.new_key() for _ in range(4)]

    tmp = tempfile.mkdtemp(prefix="sync-stress-")
    (Path(tmp) / "roster.json").write_text(json.dumps([{"pub": crypto.public_key(k), "role": "member"} for k in keys]))
    procs = [
        start_hub(hub_ids[i], ports[i], tmp, peers=[ports[1 - i]],
                  LINK_BANDWIDTH_BPS=args.bandwidth, SYNC_INTERVAL_S=args.interval)
        for i in (0, 1)
    ]
    client = httpx.Client(timeout=10)
    sent: set[str] = set()
    rounds, cuts_total = [], 0
    try:
        for url in urls:
            wait_up(client, url)
        for r in range(args.rounds):
            cuts = 0
            for _ in range(args.alerts):
                i = rng.randrange(2)
                res = client.post(f"{urls[i]}/events", json=signed_alert(hub_ids[i], levels[i], rng.choice(keys), rng))
                if res.status_code != 201:
                    raise SystemExit(f"post refused: {res.status_code} {res.text}")
                sent.add(res.json()["id"])
                if rng.random() < args.cut_prob:
                    j = rng.randrange(2)
                    is_cut = client.get(f"{urls[j]}/link").json()["cut"]
                    client.post(f"{urls[j]}/link", json={"cut": not is_cut})
                    cuts += 0 if is_cut else 1
                time.sleep(rng.uniform(0, 0.05))
            for url in urls:
                client.post(f"{url}/link", json={"cut": False})
            t0, held = time.time(), [set(), set()]
            while time.time() - t0 < args.settle_timeout:
                held = [set(client.get(f"{u}/sync/ids").json()["ids"]) for u in urls]
                if all(sent <= h for h in held):
                    break
                time.sleep(0.25)
            settle_s = time.time() - t0
            counts = [client.get(f"{u}/health").json()["events"] for u in urls]
            row = {
                "round": r + 1, "sent_total": len(sent), "cuts": cuts,
                "delivered_both": len([e for e in sent if e in held[0] and e in held[1]]),
                "duplicates": sum(c - len(h) for c, h in zip(counts, held)),
                "extra_events": sum(len(h - sent) for h in held),
                "settle_s": round(settle_s, 2),
            }
            rounds.append(row)
            cuts_total += cuts
            print(f"round {r + 1}: {row['delivered_both']}/{len(sent)} on both hubs, {cuts} cuts, "
                  f"{row['duplicates']} duplicates, settled in {row['settle_s']} s")
        verify = [client.get(f"{u}/events/verify").json() for u in urls]
        rejected = [client.get(f"{u}/rejected").json()["total"] for u in urls]
    finally:
        stop(procs)

    last = rounds[-1]
    results = {
        "split": "simulated-cuts", "backend": "sync", "date": date.today().isoformat(),
        "hubs": hub_ids, "bandwidth_bps": args.bandwidth, "rounds": args.rounds, "alerts_per_round": args.alerts,
        "seed": args.seed,
        "alerts_sent": len(sent), "delivered_to_both": last["delivered_both"], "cuts": cuts_total,
        "duplicates": sum(r["duplicates"] for r in rounds), "unknown_events": last["extra_events"],
        "chains": verify, "sync_rejections": rejected,
        "settle_s_median": median(r["settle_s"] for r in rounds),
        "settle_s_ci": bootstrap_ci([r["settle_s"] for r in rounds]),
        "per_round": rounds,
    }
    ok = (results["delivered_to_both"] == len(sent) and results["duplicates"] == 0
          and all(v["chain_intact"] and not v["gaps"] for v in verify) and sum(rejected) == 0)
    results["passed"] = ok
    table = "\n".join([
        f"## Sync under random cuts ({date.today().isoformat()}, simulated cuts, real hubs)",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Alerts delivered to both hubs | {last['delivered_both']} of {len(sent)} |",
        f"| Link cuts | {cuts_total} over {args.rounds} rounds |",
        f"| Duplicates | {results['duplicates']} |",
        f"| Chains intact, no gaps | {'yes' if all(v['chain_intact'] and not v['gaps'] for v in verify) else 'NO'} |",
        f"| Sync rejections (false forgeries) | {sum(rejected)} |",
        f"| Time to settle after restore, mean of rounds (s) | {fmt(results['settle_s_ci'], pct=False)} |",
        f"| Link speed | {args.bandwidth:g} B/s each way |",
    ])
    stem = f"sync_stress_simulated-cuts_{date.today().isoformat()}"
    out = ROOT / "eval" / "results"
    (out / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out / f"{stem}.md").write_text(table + "\n")
    print("\n" + table + f"\n\nwrote eval/results/{stem}.*  ·  hub logs in {tmp}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
