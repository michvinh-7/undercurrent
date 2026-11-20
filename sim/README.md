# sim/: the simulated Hollow (Alanna's workstream)

Signed canaries and residents on other levels, so the demo has more than one box talking.
`simulate.py` plays the crisis timeline in `world.json` against the two demo hubs: water
rises on L35, contaminated water reaches L34's taps, the L34 market fan stalls, and the L12
relay's voltage sags, while a box at the top of the shaft signs surface air readings (CO₂ and oxygen, question 13). 43 events over 3 minutes by default, including the relay's voltage readings and 7 Have / Need posts. Every sender has its own key on
the roster, so every event is signed and shows as verified. Tisya's real box (`canary-34`)
is never simulated.

```bash
hub/.venv/bin/python sim/simulate.py keys                       # sim/keys/*.key (git-ignored)
hub/.venv/bin/python hub/scripts/roster_tool.py new-key --out hub/demo/operator.key   # once
hub/.venv/bin/python sim/simulate.py roster --operator hub/demo/operator.key \
    --member <canary-34 public key>:canary-34 --out hub/demo/roster.json
(cd hub && .venv/bin/python scripts/demo_hubs.py up --signed --roster demo/roster.json)
hub/.venv/bin/python sim/simulate.py run            # --minutes 1 for faster, --dry-run to preview
```

- `world.json`: levels, which hub serves which levels, the simulated canaries (their
  `device_id`s match the mounts the Hollow map knows) and residents, the timeline, the
  hidden ground truth and the Directorate's claims. Edit freely; `simulate.py` checks it
  (no unknown senders, no floats in payloads, never the real box).
- `ground_truth/` (git-ignored, written by `run` or `truth`): `truth.json` has the true case
  counts per level next to what was reported; `directorate.json` has the official, falsified
  figures. Nothing that tunes the AI reads these.

If the hubs don't have the sim's keys on their roster but allow unsigned posts, `run` posts
unsigned and says so. If they require signing, it stops before sending anything.
Tests: `cd hub && .venv/bin/python -m pytest tests/test_simulate.py`.
