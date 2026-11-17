# Undercurrent

**The Hollow's network the Directorate can't read, can't fake, and can't shut off.**

The Hollow is an underground city of 40 levels. The Directorate controls the official network and publishes numbers that hide how bad things are. Undercurrent is the residents' own channel:

- **Canary boxes** on each level sense trouble (water on the floor, the air supply stopping, heat) and sound the alarm.
- **Hubs** are laptops or small boards that keep each level connected with no internet. They relay every alert, check it before storing it, and catch up after the link is cut.
- **Public alerts** (sensor alarms, SOS) are signed, so anyone can read them and check they're real.
- **Cell messages** (organizing) are encrypted, so only members can read them. Hubs carry them without being able to.

Built for Patriot Hackfest 2026.

---

## How it works

```
 Canary box (L34)          Resident phone
 water · fan · heat · SOS  signs its reports
          │ signed alert          │ signed report
          ▼                       ▼
     ┌──────────┐  slow link, can be cut  ┌──────────┐
     │ Hub L34  │ ◀────── sync ─────────▶ │ Hub L12  │ ──▶ console
     └──────────┘                          └──────────┘
          ▲  forge · replay · edit · cut · sniff
     The Directorate
```

Every hub runs the same checks on every event, whether it comes from a phone, a box or another hub:

1. **The signature is valid.** Members and boxes sign with Ed25519 keys; anything changed after signing fails.
2. **The signer is on the roster.** Members join in person; the roster is itself a signed event that syncs.
3. **It isn't a replay.** Event ids are set by the signer and can't repeat; fresh posts must be recent and meant for this hub.
4. **The log is a hash chain per hub,** so an edited or deleted record is found at the exact row.

Anything that fails is stored on a rejected list with its reason. That list feeds the console's "forgeries blocked" counter.

Messages are sent over a slow, cuttable link, highest priority first. A small local AI (`llama3.2:3b` via Ollama) scores how urgent each resident report is; sensor alerts get their priority by rule.

## What we measured

Every number comes from a real run of the code in this repo. Anything simulated says so.

| Claim | Result | How |
|---|---|---|
| Forged and replayed messages accepted | **0 of 300**; all 40 real member alerts accepted | `eval/run_attacks.py`, real hub, generated attacks |
| Edited database records caught at the exact row | **140 of 140** | same script, direct edits to the hub's database |
| Alerts delivered after random link cuts | **200 of 200** after 26 cuts, 0 duplicates | `eval/run_sync_stress.py`, two real hubs, simulated cuts |
| Time from water on the probe to the alert on the other hub | waiting on the box | |
| AI urgency accuracy, local model | **76%** [69, 83] on 149 held-back messages | `eval/run_triage_eval.py` |
| SOS delay with the priority queue vs first-come | **72% shorter** | same, simulated arrivals |

Full tables with confidence intervals: [`eval/results/`](eval/results/).

**What it doesn't do:**
- **Metadata is visible.** Hubs can see who sent a cell message, when, and from which level. Hiding that, the way Tor does, is out of scope.
- **A stolen phone can sign** until a roster event removes its key.
- **A hub's own priority score isn't protected** by the hash, on purpose: the hub sets it on arrival.
- **Deleting the newest record** of a hub isn't caught by the chain alone. With two hubs, sync puts it back.

---

## Repo layout

| Folder | What lives there | Owner |
|---|---|---|
| `hub/` | FastAPI hub: event log, signature and roster checks, sync, link simulation, AI scoring | Michael |
| `eval/` | Test messages, attack and sync stress scripts, results | Michael |
| `firmware/`, `bridge/` | The Canary box: Arduino UNO Q sketch, and the Python that signs and posts alerts | Tisya |
| `sim/` | Simulated canaries and residents on other levels | Alanna |
| `web/` | Next.js: phone pages, signing, cell messages, console, Directorate view, 3D Hollow map | Alanna (phone side), Taheful (console side) |
| `shared/schemas/` | **The event format everyone builds against** | Post in the chat before changing |

Plan and status: [`REWORK_PLAN.md`](REWORK_PLAN.md) and [`STATUS.md`](STATUS.md).

## Quick start

You need Python 3.11+ and Node 20+. Ollama with `llama3.2:3b` is optional; without it, triage falls back to keyword rules.

**1. Environment**

```bash
cp .env.example .env
```

**2. One hub**

```bash
cd hub
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it: http://localhost:8000/health and http://localhost:8000/docs.

The compression experiment needs `pip install -r requirements-ai.txt` (torch and transformers); the hub itself doesn't. That keeps the hub small enough for the Canary box.

**3. Two hubs that sync**

```bash
cd hub
HUB_ID=hub-L34 HUB_DB=l34.db HUB_PEERS=http://localhost:8002 uvicorn app.main:app --port 8001
HUB_ID=hub-L12 HUB_DB=l12.db HUB_PEERS=http://localhost:8001 uvicorn app.main:app --port 8002
```

Post to one and it appears on the other. Cut a hub's link with `POST /link {"cut": true}`, post more, restore it, and everything arrives.

**4. Signing**

Unsigned events are accepted while `REQUIRE_SIGNED=0` (the default). For the demo, set `REQUIRE_SIGNED=1` and point `ROSTER_FILE` at a JSON list of members' public keys:

```json
[{"pub": "<base64 Ed25519 public key>", "role": "operator"}, {"pub": "...", "role": "member"}]
```

Python signs with `hub/app/crypto.py` (`crypto.sign`); the browser uses `web/lib/canonical.ts` with tweetnacl.

**5. Web**

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. The console is at `/dashboard`.

**6. Tests and numbers**

```bash
cd hub && pytest                               # hub tests
hub/.venv/bin/python eval/run_attacks.py       # headline numbers 1 and 2
hub/.venv/bin/python eval/run_sync_stress.py   # headline number 3
```

## The event format

Every report is one **event** in an append-only log. The full definition is in `shared/schemas/event.schema.json`, with one example per type in `shared/schemas/examples/`.

```json
{
  "id": "uuid, set by the signer",
  "type": "checkin | hazard | case | missing_person | roster",
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

- **The signer sets** `id`, `created_at` and `hub_id`, then signs every field above except `priority`, `sig`, `prev_hash` and `hash`. Null fields are left out; keys are sorted at every depth.
- **`priority`** is 0 to 1, set by the hub on arrival. It's outside the signature so the hub can score it.
- **`prev_hash` and `hash`** chain each hub's events: `hash` = SHA-256 of the signed fields + `sig` + `prev_hash`.
- **A sensor alert** is a `hazard` with `source: "sensor"`. **The SOS button** is a `checkin` with `status: "need_help"`. **A cell message's** payload is `{enc, nonce, ciphertext}`.

## Hub API

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Hub id, event count, whether the chain is intact |
| POST | `/events` | Add an event. Checked first; a failed check returns 403 with the reason |
| GET | `/events` | List events. Filters: `type`, `level`, `since` |
| GET | `/events/stream` | Live feed (Server-Sent Events); resumes via `Last-Event-ID` |
| GET | `/events/verify` | Check every chain: `chain_intact`, `first_bad_event`, and `gaps` (another hub's events still in transit) |
| GET | `/rejected` | Events that failed the checks, with reasons. `total` is the "forgeries blocked" counter |
| GET | `/roster` | Members, and whether signing is required |
| POST | `/roster` | Add or remove a member. Must be signed by an operator |
| GET | `/link` | The simulated outbound link: bandwidth, cut or not, queue size |
| POST | `/link` | `{"bandwidth_bps": 200}`, `{"unlimited": true}`, `{"cut": true}` / `{"cut": false}` |
| GET | `/sync/ids` | Every event id this hub holds |
| POST | `/sync/events` | Events from a peer hub, each checked before it's stored |
| GET | `/sync/status` | Peers, last success, events in flight, gaps |
| POST | `/triage` | Messy text in, a structured record with a priority out |
| POST | `/organize` | A symptom report in the fixed responder format. Documents, never diagnoses |

## How we work

- `main` always works. Never merge something you haven't run.
- One working branch per person, named `person/what`: `michael/sync`, `tisya/canary-box`, `alanna/phones-and-sim`, `taheful/console`.
- Merge something working at least once a day, and pull `main` into your branch before you push.
- Post in the group chat before changing `shared/schemas/`, `hub/requirements.txt`, `hub/requirements-ai.txt` or `web/package.json`.
- Real keys live only in `.env`, and private signing keys are never committed.
- Wed 11/18 night: tag `demo-v1`. After that, only bug fixes.

Roles, tasks and schedule: see the team contract.
