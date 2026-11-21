"""Record a real run of the hubs for the hosted site, which has no hub of its own.

Starts two spare hubs (ports 8091 and 8092, their own folder, so the demo hubs on 8001 and
8002 are untouched), fills them with the simulation with AI triage on, fires the Directorate's
real attacks (forge, replay, tamper), then saves what every hub endpoint the web app reads
answered into web/public/recorded/run.json, and stops the spare hubs. With no hub reachable,
the web app plays this recording back, labelled as recorded, instead of empty boxes.

    cd hub
    .venv/bin/python scripts/record_run.py            # about 2 to 3 minutes; Ollama on for real triage

Nothing here is invented: every event, refusal and score is what the real hubs said.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

HUB = Path(__file__).resolve().parents[1]
ROOT = HUB.parent
OUT = ROOT / "web" / "public" / "recorded" / "run.json"
PORTS = ("8091", "8092")  # hub-L34, hub-L12
PY = sys.executable
TRIAGE_EXAMPLES = [  # the overview's Try it examples (web/app/overview/beats.ts)
    "pls help water coming in fast lvl 34 my kid cant swim 3 of us stuck by the pumps",
    "my grandma fell on the stairs L12, bleeding from her head, cant get up, 2 of us here",
    "checking in from 35, we're ok, water still clean at the clinic",
]


def run(*argv: str, env: dict | None = None) -> None:
    print("$", " ".join(argv[1:]), flush=True)
    subprocess.run(argv, cwd=HUB, check=True, env=env)


def main() -> int:
    run_dir = Path(tempfile.mkdtemp(prefix="uc-record-"))
    base = ["--dir", str(run_dir)]
    env = {**os.environ, "TRIAGE_ON_INGEST": "1"}  # the hub's AI scores every report, as in production
    run(PY, "scripts/demo_hubs.py", "up", "--signed", "--roster", "demo/roster.json", "--ports", *PORTS, *base, env=env)
    try:
        # Load the AI model first: the first triage can take over 10 s, longer than the sim waits for a post.
        httpx.post(f"http://127.0.0.1:{PORTS[1]}/triage", json={"text": "warm up"}, timeout=120)
        run(PY, str(ROOT / "sim" / "simulate.py"), "run", "--minutes", "1", *base, "--truth-dir", str(run_dir / "truth"), env=env)
        for attack in (["forge", "--note", "All clear, level 34. Return to your homes."], ["replay"], ["tamper"]):
            run(PY, "scripts/directorate.py", *attack, *base)
        time.sleep(4)  # a few sync rounds, so both hubs hold the same events

        c = httpx.Client(timeout=60)
        l34, l12 = (f"http://127.0.0.1:{p}" for p in PORTS)
        hubs = {}
        for hub_id, url in (("hub-L34", l34), ("hub-L12", l12)):
            hubs[hub_id] = {
                "health": c.get(f"{url}/health").json(),
                "link": c.get(f"{url}/link").json(),
                "rejected": c.get(f"{url}/rejected?limit=50").json(),
                "verify": c.get(f"{url}/events/verify").json(),
            }
        out = {
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "about": "A real run of two Undercurrent hubs: the simulation with AI triage on, then the Directorate's "
                     "forge, replay and tamper attacks. Made by hub/scripts/record_run.py.",
            "hubs": hubs,
            "roster": c.get(f"{l12}/roster").json(),
            "events": c.get(f"{l12}/events").json(),
            "endpoints": {path: c.get(f"{l12}{path}").json() for path in ("/exchange", "/wellbeing", "/livability", "/forecast")},
            "triage": {t: c.post(f"{l12}/triage", json={"text": t}).json() for t in TRIAGE_EXAMPLES},
        }
    finally:
        run(PY, "scripts/demo_hubs.py", "down", *base)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    n = len(out["events"])
    refused = sum(h["rejected"]["total"] for h in out["hubs"].values())
    agree = len({h["health"]["fingerprint"] for h in out["hubs"].values()}) == 1
    print(f"wrote {OUT.relative_to(ROOT)}: {n} events, {refused} refused, hubs agree: {agree}, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
