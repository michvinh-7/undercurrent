# Undercurrent

**The Hollow's network the Directorate can't read, can't fake, and can't shut off.**

The Hollow is an underground city of 40 levels. The Directorate controls the official network, can cut it at will, and publishes numbers that hide how bad things are. Undercurrent is the residents' own channel, and the tools they build on top of it:

- **Canary boxes** on each level sense trouble (water on the floor, the supply voltage sagging, heat, the air going bad) and sound the alarm. Each box signs its own alerts.
- **Residents' phones** join in person by QR code, then sign every report: check-ins, hazards, symptoms, missing persons, Have / Need posts.
- **Hubs** keep each level connected with no internet. They check every message before storing it, chain every record, and sync with each other, catching up after the link is cut.
- **Public alerts** are signed, so anyone can read them and check they're real. **Cell messages** are encrypted on the phone, so only members can read them; hubs carry them without being able to.
- **On top of the network:** AI triage that puts the SOS first on a slow link, a blackout forecast from the box's voltage readings, a Have / Need board that shares what's left fairly, daily sleep and mood check-ins, and a signed reading of the surface air.

Built for Patriot Hackfest 2026 by Tisya, Michael, Alanna and Taheful.

---

## How it works

```
 Canary box (L34, Arduino UNO Q)        Resident phone
 water · voltage · heat · fan · SOS     joins by QR, signs every report
          │ signed alert                      │ signed report / sealed cell message
          ▼                                   ▼
     ┌──────────┐  slow link, can be cut  ┌──────────┐
     │ Hub L34  │ ◀────────── sync ──────▶ │ Hub L12  │ ──▶ console · 3D map · Directorate view
     └──────────┘                          └──────────┘
          ▲  forge · replay · edit · cut · sniff
     The Directorate
```

**The Canary box** is an Arduino UNO Q, which makes the box its own hub. Its microcontroller reads the sensors and runs the alarm rules: a water probe that must stay wet past its threshold for 3 seconds, an SOS button, an LED and buzzer, temperature, and a fan monitor. A bridge passes each reading to the board's Linux side, where `bridge/canary_bridge.py` signs it with the box's key and posts it to the hub running on the same board. That hub syncs with the next level's hub over Wi-Fi.

Every hub runs the same checks on every event, whether it comes from a phone, a box or another hub:

1. **The signature is valid.** Members and boxes sign with Ed25519 keys; anything changed after signing fails.
2. **The signer is on the roster.** Members join in person; the roster is itself a signed event that syncs.
3. **It isn't a replay.** Event ids are set by the signer and can't repeat; fresh posts must be recent and meant for this hub.
4. **The log is a hash chain per hub,** so an edited record is found at the exact row, and a deleted one is put back by the other hub.

Anything that fails goes on a rejected list with its reason. That list is the console's "forgeries blocked" counter.

**Don't trust the hub: check it.** `hub/scripts/verify.py` is an independent audit that imports none of the hub's code: about 300 lines of standard library plus PyNaCl. Give it a live hub, a hub's database file or an export, plus the roster you got in person. It recomputes every hash and signature, replays the roster to check that each signer was a member when it signed, finds forks and deleted rows, and cross-checks two hubs event by event. It can sign its report with the auditor's own key, so the verdict can be passed on and checked too.

**What runs on top:**

| Feature | What it does | Where |
|---|---|---|
| AI triage | A small model on the hub (Llama 3.2 3B via Ollama, offline) reads messy text and pulls out the facts; code turns them into a priority and checks every number against the message, so the SOS crosses a slow link first | `hub/app/triage.py`, `POST /triage` |
| Blackout forecast | A least-squares line through a relay box's last 8 voltage readings predicts when the supply drops to 180 V, with a range; it only warns when the fall is clear of the noise | `hub/app/forecast.py`, `GET /forecast` |
| Have / Need board | Signed offers and requests (space, food, water, medicine, power), matched to the nearest offer, medicine and water first, then the longest-waiting; only the poster can close a post | `hub/app/exchange.py`, `GET /exchange` |
| Livability Index | One 0-100 score per level from signed readings, reports, the blackout forecast, unmet needs and check-ins; plain rules, "no data" never counts as fine, one unsafe dimension makes the level unsafe, and every number links to its events | `hub/app/livability.py`, `GET /livability` |
| Sleep, mood and roll call | Optional answers on the daily check-in, averaged per level only once 2+ people answer; plus who hasn't been heard from today | `hub/app/wellbeing.py`, `GET /wellbeing` |
| Cell messages | XSalsa20-Poly1305 (tweetnacl secretbox) under a key shared in person by QR | `web/lib/cell.ts`, `/cell` |
| Surface check | A box at the top of the shaft signs CO₂ and oxygen, next to the Directorate's "the air kills in minutes" | `/overview`, map Briefs #13 |

## The 15 questions

The brief asks 15 questions. Undercurrent answers 12 with working features, 1 partly, and has designs for the last 2, all on the same signed network.

| | Questions |
|---|---|
| **Built and live** | 1 warn before blackouts · 2 share fairly · 3 keep levels livable (the Livability Index) · 4 catch bad water · 5 safe tunnels · 6 share space · 7 organize without their network · 8 reconnect families · 9 the real outbreak · 10 care that reaches people · 11 life without sunlight · 13 is the surface safe |
| **Partly** | 12 grow food (shared on the board, nothing helps grow it) |
| **Designed, not built** | 14 suits, domes or outposts · 15 plan the move up (both on `/overview`) |

## What we measured

Every number comes from a real run of the code in this repo. Anything simulated or synthetic says so. Full tables with 95% intervals: [`eval/results/RESULTS.md`](eval/results/RESULTS.md).

| Claim | Result | How |
|---|---|---|
| Forged and replayed messages accepted | **0 of 300**; all 40 real member alerts accepted | `eval/run_attacks.py`, real hub, generated attacks |
| Edited database records caught at the exact row | **160 of 160**, deleting the newest row included | same script, direct edits to the hub's database |
| Deleted rows put back by the other hub | **20 of 20**, chain intact | same script, two real hubs synced |
| Adaptive attackers, isolated episodes | **0 breaches** in 40,000 fuzzer attempts (2,000 episodes) and 20 episodes of a local LLM playing the Directorate; every database edit flagged or put back by sync; reset **0.9 ms**, identical to the starting hub 2,020 of 2,020 times. It found and we fixed a crash: a row edited to level 999999 took the hub's pages down | `eval/run_directorate_gym.py` |
| Alerts delivered after random link cuts | **200 of 200** after 26 cuts, 0 duplicates | `eval/run_sync_stress.py`, two real hubs, simulated cuts |
| Water on the probe to the alert on the other hub | **0.81 s** median, 30 of 30 | `eval/run_probe_latency.py`, dry run with a simulated box; `--real` with the Canary box |
| AI triage urgency accuracy | **76%** offline (local Llama 3.2 3B, the model the hub runs) vs **54%** for keyword rules, 149 held-out messages. Cloud Gemini: 88%. Microsoft's Phi-4-mini, also offline: 77%, but worse at ranking SOS first (55% vs 62%), so the hub keeps Llama | `eval/run_triage_eval.py` |
| SOS delay with the priority queue | **72–76% shorter** than first-come-first-served | same, simulated arrivals |
| Blackout forecast, an hour before drop-out | **6 min** off vs 27 min for a two-reading guess; **0%** false alarms on steady power vs 35% | `eval/run_forecast_eval.py`, 1,000 synthetic sags |

**What it doesn't do:**
- **Metadata is visible.** Hubs can see who sent a cell message, when, and from which level. Hiding that, the way Tor does, is out of scope.
- **A stolen phone can sign** until an operator removes its key (one roster event, synced to every hub).
- **A hub's own priority score isn't protected** by the hash, on purpose: the hub sets it on arrival.
- **One hub alone can't see some deletions.** With the laptop, deleting the newest row together with the hub's record of writing it, or deleting rows of the *other* hub's chain, looks to that hub like rows that haven't arrived yet. The other hub still holds them, and the next sync round puts them back (found and measured by the Directorate gym).
- **Cutting the power to a hub** stops it; nothing is lost, but nothing moves until it's back.

---

## The pages

Start the web app (below) and open http://localhost:3000. Laptop pages take `?hub=<url>&peer=<url>`; the shared top bar keeps them as you move between pages, and shows both hubs, the link, whether the hubs agree, forgeries blocked and signing.

| Page | For | Shows |
|---|---|---|
| `/pitch` | Judges, 3 minutes | Eight full-screen slides (the stakes, the answer, the Canary box, attacks live, AI and the forecast, sharing and wellbeing, the 15 questions, the numbers and team), each with a live component and a takeaway. → / Space next, N speaker notes, P auto-play, F full screen |
| `/overview` | Judges, the deep dive | How it works, the five demo beats with live proof and the command for each, AI triage, the forecast, the board, sleep and mood, the surface, the designs for 14 and 15, the numbers |
| `/dashboard` | The operator | Priority queue, forgeries, the link (with a cut button), the chain check, missing persons |
| `/hollow` | Everyone | The 3D city, one level at a time, with alerts where they happened and a Briefs tab for all 15 questions |
| `/truth` | The Directorate's eye | The bytes a tap captures next to what a member reads |
| `/`, `/checkin`, `/hazard`, `/symptoms`, `/missing`, `/exchange` | Residents' phones | Signed reports, the Have / Need board |
| `/join`, `/cell` | Residents' phones | The join QR for the operator; encrypted cell messages and the invite QR |

## Repo layout

| Folder | What lives there | Owner |
|---|---|---|
| `firmware/`, `bridge/` | The Canary box: Arduino UNO Q sketch, and the Python that signs and posts its alerts | Tisya |
| `hub/` | FastAPI hub: event log, signature and roster checks, sync, link simulation, AI triage, forecast, board, wellbeing | Michael |
| `eval/` | Test messages, attack, sync, latency and forecast scripts, results | Michael |
| `sim/` | Simulated canaries and residents on other levels, all signed and labelled simulated | Alanna |
| `web/` | Next.js: phone pages, signing, cell messages, console, Directorate view, 3D Hollow map, overview, pitch | Alanna (phone side), Taheful (console, map, Directorate view) |
| `shared/schemas/` | **The event format everyone builds against** | Post in the chat before changing |

Plan and status: [`REWORK_PLAN.md`](REWORK_PLAN.md) and [`STATUS.md`](STATUS.md).

**Built with:** Next.js 15, React 19, Tailwind 4, shadcn/ui, three.js and React Three Fiber, FastAPI, SQLite, PyNaCl and tweetnacl (Ed25519, XSalsa20-Poly1305), Ollama (Llama 3.2 3B), Gemini (evaluation), Arduino UNO Q.

## Quick start

You need Python 3.11+ and Node 20+. Ollama with `llama3.2:3b` is optional; without it, triage falls back to keyword rules and says so.

**1. Environment and hub**

```bash
cp .env.example .env
cd hub
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

The hub needs only `requirements.txt`, small enough for the Canary box. The compression experiment adds `requirements-ai.txt` (torch, transformers).

**2. Keys, roster and the two demo hubs**

```bash
cd ~/undercurrent
hub/.venv/bin/python hub/scripts/roster_tool.py new-key --out hub/demo/operator.key        # once
hub/.venv/bin/python sim/simulate.py keys                                                  # the sim's senders
hub/.venv/bin/python sim/simulate.py roster --operator hub/demo/operator.key \
    --member <canary-34 public key>:canary-34 --out hub/demo/roster.json
cd hub
.venv/bin/python scripts/demo_hubs.py up --signed --roster demo/roster.json --host 0.0.0.0
```

That starts hub-L34 on :8001 and hub-L12 on :8002, synced, with signing required, and prints the link to open on a phone. `status`, `reset` (wipes both, keeps the roster) and `down` do what they say. Add a phone with `roster_tool.py add <key> --hub http://localhost:8001 --operator demo/operator.key`, or remove a stolen one with `remove`; the change syncs to both hubs.

**3. Web**

```bash
cd web
npm install
npm run dev          # for recording: npm run build && npm start
```

Open http://localhost:3000/pitch?hub=http://127.0.0.1:8002&peer=http://127.0.0.1:8001.

**4. Fill the city and play the Directorate**

```bash
hub/.venv/bin/python sim/simulate.py run          # 47 signed events over 3 minutes: water, bad water, bad air,
                                                   # a sagging relay, Have / Need posts, check-ins, the surface box
cd hub
.venv/bin/python scripts/directorate.py forge     # fake "all clear" from an unknown key → refused
.venv/bin/python scripts/directorate.py cut       # alerts wait; then `restore` and they all arrive
.venv/bin/python scripts/directorate.py edit      # change a stored record → the chain check names the row
.venv/bin/python scripts/directorate.py delete    # delete the newest record → flagged, then put back
.venv/bin/python scripts/directorate.py status    # both hubs: counter, fingerprint, do they agree
.venv/bin/python scripts/verify.py --hub http://127.0.0.1:8001 --hub http://127.0.0.1:8002 --roster demo/roster.json
                                                   # independent audit: PASS, or the exact row that fails
```

**5. Tests and numbers**

```bash
cd hub && .venv/bin/python -m pytest            # hub tests, including real-process sim and demo-script tests
cd web && node --import ./lib/node-ts-resolve.mjs --test lib/lib.test.mjs app/hollow/city/city.test.mjs
hub/.venv/bin/python eval/run_attacks.py         # numbers 1 and 2
hub/.venv/bin/python eval/run_sync_stress.py     # number 3 (add --real with two laptops)
hub/.venv/bin/python eval/run_probe_latency.py   # number 4 (add --real with the Canary box)
hub/.venv/bin/python eval/run_forecast_eval.py   # the blackout forecast backtest
hub/.venv/bin/python eval/make_results_table.py  # rebuild eval/results/RESULTS.md
```

## The event format

Every report is one **event** in an append-only log. The full definition is in `shared/schemas/event.schema.json`, with examples in `shared/schemas/examples/`.

```json
{
  "id": "uuid, set by the signer",
  "type": "checkin | hazard | case | missing_person | roster | exchange",
  "hub_id": "hub-L34",
  "level": 34,
  "created_at": "2087-03-14T02:11:00Z",
  "author": "anon-7f3a",
  "author_pub": "Ed25519 public key, base64",
  "sig": "signature, base64",
  "source": "resident | sensor",
  "device_id": "canary-34",
  "priority": 0.94,
  "payload": { },
  "prev_hash": "...",
  "hash": "..."
}
```

- **The signer sets** `id`, `created_at` and `hub_id`, then signs every field above except `priority`, `sig`, `prev_hash` and `hash`. Null fields are left out; keys are sorted at every depth; numbers in payloads are whole numbers.
- **`priority`** is 0 to 1, set by the hub on arrival, outside the signature so the hub can score it.
- **`prev_hash` and `hash`** chain each hub's events: `hash` = SHA-256 of the signed fields + `sig` + `prev_hash`.
- **A sensor alert** is a `hazard` with `source: "sensor"` and its reading in `payload.reading` (`{value, unit}`). **The SOS button** is a `checkin` with `status: "need_help"`; a check-in can carry `sleep_h` and `mood`. **A cell message's** payload is `{enc, nonce, ciphertext}`. **A Have / Need post** is an `exchange` with `side`, `category` and `item`; `{closes: <id>}` from the same key closes it. Simulated events carry `simulated: true` inside the signature.

## Hub API

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Hub id, event count, whether the chain is intact, fingerprint |
| POST | `/events` | Add an event. Checked first; a failed check returns 403 with the reason |
| GET | `/events` | List events. Filters: `type`, `level`, `since` |
| GET | `/events/stream` | Live feed (Server-Sent Events); resumes via `Last-Event-ID` |
| GET | `/events/verify` | Check every chain: `chain_intact`, `first_bad_event`, `gaps` |
| GET | `/rejected` | Events that failed the checks, with reasons. `total` is the "forgeries blocked" counter |
| GET | `/roster` | Members, and whether signing is required |
| POST | `/roster` | Add or remove a member. Must be signed by an operator |
| GET | `/link` | The simulated outbound link: bandwidth, cut or not, queue size |
| POST | `/link` | `{"bandwidth_bps": 200}`, `{"unlimited": true}`, `{"cut": true}` / `{"cut": false}` |
| GET | `/sync/ids` | Every event id this hub holds, and its fingerprint |
| POST | `/sync/events` | Events from a peer hub, each checked before it's stored |
| GET | `/sync/status` | Peers, events in flight, gaps, rows restored, fingerprint, whether each peer agrees |
| POST | `/triage` | Messy text in, a structured record with a priority out, and which model read it |
| POST | `/organize` | A symptom report in the fixed responder format. Documents, never diagnoses |
| GET | `/forecast` | Per voltage-reporting box: trend, status and when it reaches the cutoff (`?cutoff=180`) |
| GET | `/exchange` | The Have / Need board: open needs and offers, matches, counts per level |
| GET | `/wellbeing` | Sleep and mood per level (2+ answers only) and the roll call (`?window_h=24`) |
| GET | `/livability` | The Livability Index: a 0-100 score per level, each dimension with its reason and the signed events behind it (`?window_h=6`) |

## How we work

- `main` always works. Never merge something you haven't run.
- One working branch per person: `michael/sync`, `tisya/canary-box`, `alanna/phones-and-sim`, `taheful/hollow-layout`.
- Pull `main` into your branch before you push, and merge working changes through a PR.
- Post in the group chat before changing `shared/schemas/`, `hub/requirements.txt` or `web/package.json`.
- Real keys live only in `.env` and `*.key` files, which are never committed.

Roles, tasks and schedule: the team contract.
