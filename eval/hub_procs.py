"""Start real hubs (uvicorn subprocesses) for the eval scripts, and sign alerts for them."""

import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hub"))

from app import crypto  # noqa: E402


def start_hub(hub_id: str, port: int, tmp: str, peers: list[int] = (), **env_extra) -> subprocess.Popen:
    """A hub on `port` with signing required, the roster at tmp/roster.json, no AI scoring,
    and its database and log in `tmp`. `peers` = ports of hubs to sync with."""
    env = {
        **os.environ,
        "HUB_ID": hub_id,
        "HUB_DB": str(Path(tmp) / f"{hub_id}.db"),
        "HUB_PEERS": ",".join(f"http://127.0.0.1:{p}" for p in peers),
        "REQUIRE_SIGNED": "1",
        "ROSTER_FILE": str(Path(tmp) / "roster.json"),
        "TRIAGE_ON_INGEST": "0",
        **{k: str(v) for k, v in env_extra.items()},
    }
    log = open(Path(tmp) / f"{hub_id}.log", "w")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT / "hub", env=env, stdout=log, stderr=subprocess.STDOUT,
    )


def wait_up(client: httpx.Client, url: str, timeout: float = 30) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if client.get(f"{url}/health").status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise SystemExit(f"hub at {url} didn't start; see its log in the temp folder")


def stop(procs: list[subprocess.Popen]) -> None:
    for p in procs:
        p.terminate()
    for p in procs:
        p.wait(timeout=10)


def iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def alert_fields(hub_id: str, level: int, rng, age: timedelta = timedelta(0)) -> dict:
    """An unsigned sensor alert addressed to `hub_id`, created `age` ago."""
    return {
        "id": str(uuid.uuid4()), "type": "hazard", "hub_id": hub_id, "level": level,
        "created_at": iso(datetime.now(timezone.utc) - age),
        "author": f"canary-{level}", "source": "sensor", "device_id": f"canary-{level}",
        "payload": {"kind": rng.choice(["flooding", "bad_air", "heat"]), "severity": rng.choice(["low", "medium", "high"])},
    }


def signed_alert(hub_id: str, level: int, key, rng, **kw) -> dict:
    signed = crypto.sign(alert_fields(hub_id, level, rng, **kw), key)
    signed["priority"] = round(rng.random(), 2)  # outside the signature, like the hub's own score
    return signed
