# Team status

**Last updated:** Mon 11/16 by Michael
**Based on:** what's in the repo (`main` plus pushed branches). If you've done work that isn't pushed, it isn't counted here. Push it, or edit your section.

Tasks are copied from the team contract. `[x]` means done and in the repo. Anything partly done stays unchecked, with a note saying what's left.

**How to update:** edit your own section when you finish something, and change the date above. Keep notes to one line.

---

## Tonight: base integration (Mon 11/16)

The base has to work end to end before any upgrade starts.

| Base checklist item | Status |
|---|---|
| A phone opens the hub page and submits a check-in, hazard, case or missing person | 🟡 All 4 forms work end to end in a phone-sized browser. The phone opens `http://<laptop-ip>:3000` for now, until the hub serves the pages itself. Not yet tried on a real phone |
| It's saved to the hub's log and appears on the dashboard | ✅ Tested end to end: report saved, then shown live on `/dashboard` |
| The AI turns a messy message into a structured record with a priority score | 🟡 Works through `POST /triage`, but it isn't connected to the hub yet (needs 2 lines in `main.py`). Until it is, phone reports show as "unscored" on the dashboard |
| Two hubs edit separately, reconnect and merge with nothing lost | ❌ Sync isn't started |
| The hazard map and Truth screen show community numbers next to the official ones | ❌ Not started |
| The online mirror is live | ❌ Not started |

**Blocking the most people:**
1. **Sync (Tisya).** "Zero lost reports" is our core claim, and two base items depend on it.
2. **Connecting triage to the hub (Tisya + Michael),** so reports arrive with a priority.
3. **Hazard map and Truth screen (Taheful),** plus the official numbers they compare against (Alanna).

**Not merged yet.** Each part is on its owner's branch, waiting for their review. Merge them in this order:
1. `tisya/stream-and-link`: the live stream and link (the dashboard needs these for live data).
2. `alanna/phone-pages`: the phone forms.
3. `taheful/dashboard`: the dashboard. It builds on its own, but shows fake examples until step 1 is merged.

---

## Person 1: Hubs, sync and network (Tisya)

- [x] Kickoff: agree on the event format; set up the repo, `.env.example` and the FastAPI skeleton. *(Done in the scaffold.)*
- [x] `hub.py`: endpoints to add an event, list events (filtered by type and level) and stream new events.
  - *Lives in `hub/app/main.py`.*
  - *The stream (`GET /events/stream`) is on branch `tisya/stream-and-link` and needs Tisya's review before it's merged.*
- [x] `log.py`: SQLite append-only log, each event hash-chained to the one before it. *(Includes tamper-detection tests.)*
- [ ] Serve the phone pages from the hub, so a phone on the hub's Wi-Fi needs no internet and no app.
- [ ] `sync.py`: two hubs exchange the events the other is missing; merge = union by id; verify the hash chain on arrival.
- [ ] Test: two hubs edit offline, reconnect and compare counts, with zero lost or duplicated events.
- [ ] `link.py`: adjustable bandwidth between hubs (bytes per second); the queue sends highest priority first.
  - *Bandwidth, priority order, cut/restore and `GET/POST /link` are built and tested on `tisya/stream-and-link`.*
  - *It isn't carrying anything between hubs yet, because that needs sync.*
- [ ] Deploy one demo hub online (Render, Fly.io or Azure) for the judges' mirror.
- [ ] Upgrade 1: each teammate runs a hub, connected peer to peer (Tailscale or WebRTC); messages hop through other hubs when there's no direct path; a killed hub catches up when it returns.
- [ ] Upgrade 3 defense: trust weighting (who vouches for whom) so fake reports count less; flag bursts of fakes from one hub or author; measure how close the Truth estimate stays to the real count as fakes rise from 0% to 30%.
- [ ] Freeze to video: write the architecture slide and practice explaining sync in one sentence.

**Done when:** two hubs can be cut off, edited and reconnected on camera with every report accounted for, and the online mirror is live.

---

## Person 2: AI and evaluation (Michael)

- [ ] Kickoff: install Ollama and pick a small (3B-class) model that runs on all four laptops.
  - *`llama3.2:3b` is picked and runs on Michael's laptop (~1.6 s per message).*
  - *Each teammate still needs to confirm it runs on theirs.*
- [x] `triage.py`: messy text in, JSON out (type, level, injuries, hazard, people count, priority 0 to 1); retry once on broken JSON, then fall back to keyword rules.
  - *Priority is computed by code, not by the model.*
- [ ] Write and label ~200 test messages (SOS, urgent, routine, fake) before tuning anything; never tune on the test set.
  - *200 are drafted, 51 for tuning and 149 held back. Michael hasn't reviewed the labels yet.*
- [ ] Measure SOS ranked first (%), and time-to-deliver for critical messages vs first-come-first-served on a slow link.
  - *Only tuning-set numbers so far.*
  - *Time-to-deliver uses a simulated link until it's connected to `link.py`.*
- [x] `organize.py`: medical reports in a fixed responder format (symptoms + photo + medical card); documents, never diagnoses.
- [x] Cloud model fallback (Gemini) for the online mirror only. *(`gemini-3.1-flash-lite`, tested.)*
- [ ] Upgrade 2: compress each message to a 200-byte packet; a fact-checking model (DeBERTa NLI) confirms location, injuries, hazard and count survived; reject and retry if not. *(Starts after the base works.)*
- [ ] Upgrade 2: fair scheduler, urgent first, but no level waits longer than a set limit. *(Starts after the base works.)*
- [ ] Results table: every number with a bootstrapped 95% confidence interval. *(The confidence-interval code is built; the final table waits on the test-set run.)*
- [ ] Freeze to video: write the results slide and practice answering "how do you know it works?"

**Done when:** every message on screen has a priority and a structured record, and every claim in the video has a measured number behind it.

**Current numbers (tuning set only, not final):**

| Model | Urgency accuracy | SOS ranked first |
|---|---|---|
| llama3.2:3b, local | 59% | 36% |
| Gemini, cloud | 98% | 89% |

Prompt tuning for the local model is next.

---

## Person 3: The Hollow and the phone app (Alanna)

- [ ] Kickoff: write the world sheet: 40 levels, which levels are deep, hub locations, a blackout → water failure → outbreak timeline.
  - *`sim/world.json` has placeholder values from the scaffold, waiting for Alanna's real version.*
- [ ] Phone pages (Next.js, phone width): check-in, hazard report, symptom report with photo, missing person; each posts one event.
  - *All 4 forms are built by Michael and tested end to end at phone width; each posts one event in the schema's shape. They remember the resident's level and give them an anonymous handle.*
  - *Left: the photo on the symptom report, which needs somewhere on the hub to store photos (see the next task).*
  - *Alanna: restyle or reword anything you like. Shared pieces are in `web/components/phone.tsx`.*
- [ ] Photos stay on the hub where they were taken; only text and a tiny thumbnail sync.
- [ ] Medical card stored encrypted on the phone (allergies, conditions, medications) that fills the symptom report.
- [ ] `simulate.py`: generates residents' messages over time from the crisis timeline, with the true case count per level saved separately. *(Stub only.)*
- [ ] The Directorate's official numbers: plausible but falsified, with the lies recorded so we can score the Truth screen.
- [ ] Hand Person 2 a slice of messages for labeling; keep the ground truth away from anything that tunes the AI.
- [ ] Upgrade 3: scale to ~10,000 residents across 40 levels; attack mode injects fake reports (from 0% to 30%), jams a hub and publishes false numbers.
- [ ] Freeze to video: play the resident on camera and write the "why the deep levels" slide.

**Done when:** a phone can file every report type, and the simulation produces a crisis with true numbers we can score against.

*Note: trust weighting was in this section in the original contract. The updated contract moves it to Person 1's Upgrade 3 defense.*

---

## Person 4: Command dashboard, Truth and the demo (Taheful)

- [ ] Kickoff: save fake examples of every event type in the frontend; deploy a hello-world to Vercel.
  - *The fake examples are done (`web/lib/fake-events.ts`, loaded from `shared/schemas/examples/`).*
  - *There's no Vercel deploy in the repo yet.*
- [x] Priority queue: incoming messages sorted by priority, with an SOS visibly jumping ahead.
  - *On `/dashboard`: live from the hub, sorted by priority; SOS is marked red, new arrivals flash. Built by Michael and tested.*
  - *Falls back to labeled fake examples when no hub answers.*
- [ ] The Hollow cross-section: 40 stacked levels, hubs as nodes, messages moving between them, hazards lighting up by level. *(The video's look; start it on day one.)*
- [x] Missing-persons board and check-in search ("seen on level 31, 2 hours ago").
  - *A side panel on `/dashboard`. Searching a name finds check-ins and missing reports, e.g. "Mara Okafor checked in on level 31, 2 hours ago".*
- [ ] Truth screen: community estimate with its confidence range next to the Directorate's figure, by level. *(`/truth` is a placeholder route.)*
- [x] Network controls: a bandwidth slider and a "cut the network" button wired to Person 1's link simulation.
  - *A side panel on `/dashboard`. Tested: the button really cuts and restores the hub's link.*
  - *The slider goes from 10 B/s to 100 kB/s, or unlimited.*
- [ ] Upgrade 3 UI: attack-mode buttons (fake reports, jam a hub, false numbers) and the Truth screen holding steady.
- [ ] Check every page at phone width and in the online mirror.
  - *Every page built so far fits 375px with no sideways scroll (tested). Needs rechecking as pages are added, and in the mirror once it exists.*
- [ ] Write the demo script, lead two rehearsals, record the video (Thu 11/19).
- [ ] Devpost page: story, how it works, results table, what it does not do.

**Done when:** a judge can open the mirror, watch messages move through the Hollow, trigger an attack and see the Truth screen hold, without anyone touching a laptop.

---

## Open questions between people

- **Tisya → Michael:**
  - OK to add the AI router to `main.py`? It's two lines: `from .ai_routes import router as ai_router` and `app.include_router(ai_router)`.
  - Should triage run before an event is appended, or patch the priority afterwards? `priority` isn't in the hash, so both are safe.
- **Everyone:** confirm `llama3.2:3b` runs on your laptop (`ollama run llama3.2:3b "say hi"`), and post how long it takes.
- **Tisya:** review `tisya/stream-and-link` (stream + link). Michael built it so Taheful isn't blocked.
- **Alanna:** review `alanna/phone-pages`. **Taheful:** review `taheful/dashboard` (queue, network controls, missing board). Michael built them to unblock tonight's base check. Change anything you want; they're yours.
- **Sign-off (contract page 9):** each person ticks their box once they've read their section.
