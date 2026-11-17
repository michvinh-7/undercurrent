"""Headline number 4: from water on the probe to the alert on the other hub's console.

Watches the receiving hub's live feed (GET /events/stream, what the console shows)
for sensor alerts and times each one from detection to arrival. Detection time is
`payload.detected_at`, which the Canary box sets (UTC, milliseconds), so the box's
clock must be synced (NTP). Without it the script falls back to `created_at`,
which only has 1-second precision.

Simulated canary (default, runs anywhere): starts two real hubs that sync, then a
script plays the box and posts signed alerts to the first hub.

    hub/.venv/bin/python eval/run_probe_latency.py               # 30 simulated alerts
    hub/.venv/bin/python eval/run_probe_latency.py --bandwidth 2000

Real box (Wednesday): the box posts to its own hub, which syncs to the receiver.
Start this, then put water on the probe N times.

    hub/.venv/bin/python eval/run_probe_latency.py --real --receiver http://<hub-L12>:8000 --n 20

Includes everything a viewer would wait for: signing, the post, the sync interval
(SYNC_INTERVAL_S, 1 s by default), the link, and the console feed's 0.5 s poll.
"""

import argparse
import json
import random
import sys
import tempfile
import threading
import time
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import median

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hub_procs import ROOT, alert_fields, crypto, start_hub, stop, wait_up  # noqa: E402
from stats import bootstrap_ci, fmt  # noqa: E402

BOX_HUB, BOX_LEVEL, RECEIVER_HUB = "hub-L34", 34, "hub-L12"


def detected_ms() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(text: str) -> float:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def listen(url: str, arrivals: dict, stop_flag: threading.Event):
    """Record when each sensor alert first appears on the receiver's live feed."""
    try:
        with httpx.Client(timeout=None) as client:
            with client.stream("GET", f"{url}/events/stream", params={"type": "hazard"}) as r:
                for line in r.iter_lines():
                    if stop_flag.is_set():
                        return
                    if not line.startswith("data: "):
                        continue
                    now = time.time()
                    e = json.loads(line[6:])
                    if e.get("source") == "sensor" and e["id"] not in arrivals:
                        sent = e["payload"].get("detected_at") or e["created_at"]
                        arrivals[e["id"]] = (now - parse_time(sent), "detected_at" in e["payload"])
    except httpx.HTTPError:
        if not stop_flag.is_set():  # the feed dropped mid-run; say so instead of failing silently
            print("live feed disconnected before the run finished")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=30, help="alerts to time")
    ap.add_argument("--real", action="store_true", help="time a real box; don't start hubs")
    ap.add_argument("--receiver", default="http://127.0.0.1:8122", help="the other hub's URL (with --real)")
    ap.add_argument("--bandwidth", type=float, default=0, help="simulated link B/s (0 = unlimited, like Wi-Fi)")
    ap.add_argument("--interval", type=float, default=1.0, help="hubs' SYNC_INTERVAL_S (simulated mode)")
    ap.add_argument("--gap", type=float, default=2.0, help="average seconds between simulated alerts")
    ap.add_argument("--timeout", type=float, default=600)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    arrivals: dict[str, tuple[float, bool]] = {}
    stop_flag = threading.Event()
    procs, sent_ids = [], []
    tmp = tempfile.mkdtemp(prefix="probe-latency-")
    client = httpx.Client(timeout=10)
    try:
        if args.real:
            receiver = args.receiver
            wait_up(client, receiver)
        else:
            box_key = crypto.new_key()
            (Path(tmp) / "roster.json").write_text(json.dumps([{"pub": crypto.public_key(box_key), "role": "member"}]))
            ports = (8121, 8122)
            extra = {"LINK_BANDWIDTH_BPS": args.bandwidth, "SYNC_INTERVAL_S": args.interval}
            procs = [start_hub(BOX_HUB, ports[0], tmp, peers=[ports[1]], **extra),
                     start_hub(RECEIVER_HUB, ports[1], tmp, peers=[ports[0]], **extra)]
            box, receiver = (f"http://127.0.0.1:{p}" for p in ports)
            for u in (box, receiver):
                wait_up(client, u)

        threading.Thread(target=listen, args=(receiver, arrivals, stop_flag), daemon=True).start()
        time.sleep(1)  # let the feed connect

        if args.real:
            print(f"Listening on {receiver}. Put water on the probe {args.n} times.")
        else:
            for i in range(args.n):
                fields = alert_fields(BOX_HUB, BOX_LEVEL, rng)
                fields["payload"] = {"kind": "flooding", "severity": "high", "detected_at": detected_ms()}
                r = client.post(f"{box}/events", json=crypto.sign(fields, box_key))
                r.raise_for_status()
                sent_ids.append(fields["id"])
                time.sleep(rng.uniform(0, 2 * args.gap))

        end = time.time() + args.timeout
        while time.time() < end and len(arrivals) < args.n:
            time.sleep(0.2)
    finally:
        stop_flag.set()
        stop(procs)

    rows = list(arrivals.values())[: args.n]
    latencies = [s for s, _ in rows]
    precise = all(p for _, p in rows)
    label = "real-box" if args.real else "simulated-canary"
    how = ("real Canary box, " if args.real else "simulated canary, two real hubs, ") + (
        f"sync every {args.interval:g} s, " if not args.real else "") + (
        "link unlimited" if not args.bandwidth else f"link {args.bandwidth:g} B/s") + (
        "" if precise else "; created_at precision (1 s)")
    results = {
        "split": label, "backend": "sync", "date": date.today().isoformat(), "how": how,
        "n": args.n, "arrived": len(rows),
        "latency_s_median": median(latencies) if latencies else None,
        "latency_s_ci": bootstrap_ci(latencies, stat=median) if latencies else None,
        "latency_s_max": max(latencies) if latencies else None,
        "detected_at_precision": "ms" if precise else "1 s",
        "latencies_s": latencies,
    }
    table = "\n".join([
        f"## Probe to the other hub's console ({date.today().isoformat()}, {label})",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Alerts arrived | {len(rows)} of {args.n} |",
        f"| Median time, detection to the other hub's feed (s) | {fmt(results['latency_s_ci'], pct=False, digits=2) if latencies else '–'} |",
        f"| Slowest (s) | {results['latency_s_max']:.2f} |" if latencies else "| Slowest (s) | – |",
        f"| Setup | {how} |",
    ])
    stem = f"probe_latency_{label}_{date.today().isoformat()}"
    out = ROOT / "eval" / "results"
    (out / f"{stem}.json").write_text(json.dumps(results, indent=2))
    (out / f"{stem}.md").write_text(table + "\n")
    print("\n" + table + f"\n\nwrote eval/results/{stem}.*")
    sys.exit(0 if len(rows) == args.n else 1)


if __name__ == "__main__":
    main()
