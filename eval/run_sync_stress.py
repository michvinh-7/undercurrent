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

--real: the same claim on a real network, with the plug really pulled. Two hubs on
two machines on the same Wi-Fi, already running and peered with each other's LAN
address (HUB_PEERS=http://<other laptop's IP>:8001), both with a roster that has
--key on it. Run this on the SENDING hub's machine: it posts to that hub (localhost,
so it keeps working with Wi-Fi off) and watches the other hub over the network.
While it runs, turn the sender's Wi-Fi off and on again, about 10 times, a few
seconds each. It counts every outage it saw (the receiver unreachable for 2 s or
more), how long the backlog took to cross after each reconnect, and at the end
whether every alert arrived once and both hubs agree (same fingerprint).

    hub/.venv/bin/python eval/run_sync_stress.py --real --sender http://localhost:8001 \
        --receiver http://192.168.1.23:8002 --key hub/demo/canary-34.key --n 50

Writes eval/results/sync_stress_real-network_<date>.*; RESULTS.md shows it first.
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


# ---------------------------------------------------------------- --real: two machines, a real cut

def run_real(args) -> int:
    key = crypto.key_from_b64(json.loads(Path(args.key).read_text())["seed"])
    client = httpx.Client(timeout=args.probe_timeout)
    sender_id = client.get(f"{args.sender}/health", timeout=5).json()["hub_id"]
    level = int("".join(c for c in sender_id if c.isdigit()) or 1)
    rng = random.Random(args.seed)

    def receiver_ids() -> list[str] | None:
        try:
            return client.get(f"{args.receiver}/sync/ids").json()["ids"]
        except httpx.HTTPError:
            return None

    first = receiver_ids()
    if first is None:
        raise SystemExit(f"can't reach the receiver at {args.receiver}: start it, and check both are on the same Wi-Fi")
    rejected_before = [client.get(f"{u}/rejected?limit=1", timeout=5).json()["total"] for u in (args.sender, args.receiver)]

    sent: list[str] = []
    sent_at_back: list[tuple[float, set[str]]] = []  # (reconnect time, alerts to wait for)
    outages, settles = [], []
    down_since = None
    next_post = time.time()
    t_start = time.time()
    end_by = None
    print(f"sending {args.n} alerts to {sender_id}, one every {args.every:g} s. Turn this laptop's Wi-Fi off "
          f"and on again during the run (about 10 times, a few seconds each).")
    while True:
        now = time.time()
        if len(sent) < args.n and now >= next_post:
            r = httpx.post(f"{args.sender}/events", json=signed_alert(sender_id, level, key, rng), timeout=5)
            if r.status_code != 201:
                raise SystemExit(f"the sender refused the alert: {r.status_code} {r.text} (is --key on its roster?)")
            sent.append(r.json()["id"])
            next_post = now + args.every
        held = receiver_ids()
        now = time.time()
        if held is None:
            down_since = down_since or now
        else:
            if down_since is not None:
                if now - down_since >= args.min_outage:
                    outages.append(round(now - down_since, 1))
                    sent_at_back.append((now, set(sent)))
                    print(f"  outage {len(outages)}: receiver unreachable for {outages[-1]} s, back now")
                down_since = None
            have = set(held)
            for t_back, wanted in list(sent_at_back):
                if wanted <= have:
                    settles.append(round(now - t_back, 2))
                    sent_at_back.remove((t_back, wanted))
            if len(sent) == args.n and set(sent) <= have:
                end_by = end_by or now
                if not sent_at_back:
                    break
        if len(sent) == args.n and time.time() - t_start > args.n * args.every + args.settle_timeout:
            print("  gave up waiting: is the Wi-Fi back on?")
            break
        time.sleep(0.25)

    held = receiver_ids() or []
    agree = False
    deadline = time.time() + 15
    while time.time() < deadline:  # the receiver may still be sending its own copy back
        fps = [client.get(f"{u}/health", timeout=5).json().get("fingerprint") for u in (args.sender, args.receiver)]
        if fps[0] and fps[0] == fps[1]:
            agree = True
            break
        time.sleep(0.5)
    verify = [client.get(f"{u}/events/verify", timeout=10).json() for u in (args.sender, args.receiver)]
    rejected = [client.get(f"{u}/rejected?limit=1", timeout=5).json()["total"] - b
                for u, b in zip((args.sender, args.receiver), rejected_before)]
    delivered = len(set(sent) & set(held))
    duplicates = sum(held.count(i) - 1 for i in set(sent) if held.count(i) > 1)
    results = {
        "split": args.label, "backend": "sync", "date": date.today().isoformat(),
        "how": args.how,
        "sender": sender_id, "alerts_sent": len(sent), "delivered_to_receiver": delivered,
        "duplicates": duplicates, "outages": len(outages), "outage_s": outages,
        "settle_s": settles, "settle_s_median": median(settles) if settles else None,
        "fingerprints_agree": agree, "chains": verify, "sync_rejections": rejected,
    }
    ok = (delivered == len(sent) == args.n and duplicates == 0 and agree and len(outages) >= 1
          and all(v["chain_intact"] for v in verify) and sum(rejected) == 0)
    results["passed"] = ok
    table = "\n".join([
        f"## Sync with the plug really pulled ({date.today().isoformat()}, {args.label})",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Alerts delivered to the other hub | {delivered} of {len(sent)} |",
        f"| Real outages (receiver unreachable 2 s or more) | {len(outages)} |",
        f"| Duplicates | {duplicates} |",
        f"| Both hubs agree (same fingerprint) | {'yes' if agree else 'NO'} |",
        f"| Chains intact | {'yes' if all(v['chain_intact'] for v in verify) else 'NO'} |",
        f"| Sync rejections (false forgeries) | {sum(rejected)} |",
        f"| Backlog crossed after reconnect, median (s) | {results['settle_s_median']} |",
        f"| How | {results['how']} |",
    ])
    stem = f"sync_stress_{args.label}_{date.today().isoformat()}"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out / f"{stem}.md").write_text(table + "\n")
    print("\n" + table + f"\n\nwrote {out / stem}.*")
    if not outages:
        print("No outage was seen: turn the Wi-Fi off for at least 2 s during the run, then run it again.")
    return 0 if ok else 1


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
    real = ap.add_argument_group("--real: two machines, the plug really pulled")
    real.add_argument("--real", action="store_true")
    real.add_argument("--sender", default="http://localhost:8001", help="the hub on THIS machine")
    real.add_argument("--receiver", help="the other machine's hub, by its LAN address")
    real.add_argument("--key", help="key file of a member on both hubs' roster (scripts/roster_tool.py new-key)")
    real.add_argument("--n", type=int, default=50, help="alerts to send")
    real.add_argument("--every", type=float, default=1.0, help="seconds between alerts")
    real.add_argument("--min-outage", type=float, default=2.0, help="seconds unreachable that count as an outage")
    real.add_argument("--probe-timeout", type=float, default=1.0)
    real.add_argument("--label", default="real-network", help="file name label; RESULTS.md only reads real-network")
    real.add_argument("--out", default=str(ROOT / "eval" / "results"))
    real.add_argument("--how", default="two machines over Wi-Fi, link cut by turning the sender's Wi-Fi off",
                      help="how the link was cut, as it should read in RESULTS.md")
    args = ap.parse_args()
    if args.real:
        if not (args.receiver and args.key):
            ap.error("--real needs --receiver and --key")
        sys.exit(run_real(args))

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
