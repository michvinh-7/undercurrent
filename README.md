# Undercurrent

**The Hollow's network the Directorate can't shut off.**

Offline hubs that keep the deep levels connected, get urgent messages through first, organize what people report, and add it up into the real numbers, shown next to the Directorate's official ones.

Built for Hack Overflow 2026 (track: Life Underground).

---

## Repo layout

| Folder | What lives there | Owner |
|---|---|---|
| `hub/` | FastAPI hub: event log, sync, link simulation, AI calls | Person 1 (hub) · Person 2 (AI) |
| `web/` | Next.js: phone pages + command dashboard | Person 3 (phone) · Person 4 (dashboard) |
| `sim/` | Simulated Hollow + ground truth | Person 3 |
| `eval/` | Labeled test messages + results scripts | Person 2 |
| `shared/schemas/` | **The event format everyone builds against** | Everyone (post before changing) |

## Quick start

You need Python 3.11+ and Node 20+.

**1. Environment**

```bash
cp .env.example .env
```

**2. Hub (backend)**

```bash
cd hub
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it: open http://localhost:8000/health and http://localhost:8000/docs.

Run a second hub on another port (for sync testing):

```bash
HUB_ID=hub-L12 HUB_DB=hub-L12.db uvicorn app.main:app --port 8001
```

**3. Web (frontend)**

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000.

**4. Tests**

```bash
cd hub && pytest
```

## The event format

Every report in Undercurrent is one **event** in an append-only log. The full definition is in `shared/schemas/event.schema.json`, and there's one example per type in `shared/schemas/examples/`.

```json
{
  "id": "uuid",
  "type": "checkin | hazard | case | missing_person",
  "hub_id": "hub-L38",
  "level": 38,
  "created_at": "2087-03-14T02:11:00Z",
  "author": "anon-7f3a",
  "priority": 0.94,
  "payload": { },
  "prev_hash": "...",
  "hash": "..."
}
```

- `id`, `hub_id`, `created_at`, `prev_hash` and `hash` are set by the hub. Clients send the rest.
- `priority` is 0 to 1, set by the AI (null until it has run).
- `hash` = SHA-256 of the event's content + `prev_hash`, so any edit to the log is detectable.

## Hub API (starter)

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Hub id, event count, whether the hash chain is intact |
| POST | `/events` | Add an event (client sends `type`, `level`, `author`, `payload`) |
| GET | `/events` | List events. Filters: `type`, `level`, `since` (ISO time) |
| GET | `/events/verify` | Re-check the whole hash chain |

Sync, link simulation and AI endpoints get added by their owners.

## How we work

- `main` always works. Never merge something you haven't run.
- Branches: `area/what`, for example `hub/sync`, `ai/triage`, `sim/outbreak`, `ui/truth-screen`.
- Merge something working at least once a day.
- Post in the group chat before changing `shared/schemas/`, `hub/requirements.txt` or `web/package.json`.
- Real keys live only in `.env`. Never commit it.
- Wed 11/18 night: tag `demo-v1`. After that, only bug fixes.

Full roles and schedule: see the team contract.
