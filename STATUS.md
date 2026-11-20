# Team status

**Last updated:** Fri 11/20 (early morning) by Michael. Everything is merged to `main`, including the 3-minute `/pitch`. **Restart the demo hubs** (`demo_hubs.py down` then `up`) if they were started before Thursday night: older hubs don't have `/forecast`, `/exchange` or `/wellbeing`, and the overview now says so instead of "Loading…". Every terminal command is on one shareable page: the [Undercurrent Command Cheat Sheet](https://claude.ai/artifact/GXyTHpoxW6QQgAkSg2WKaQ).
**Based on:** what's in the repo (`main` plus pushed branches). If you've done work that isn't pushed, it isn't counted here. Push it, or edit your section.

The plan is now the rework: the Canary box plus a signed, encrypted channel ([`REWORK_PLAN.md`](REWORK_PLAN.md)). Tasks below come from the reworked team contract, one section per person. `[x]` means done and merged into `main`. Anything partly done stays unchecked, with a note saying what's left.

**How to update:** edit only your own section when you finish something. Michael updates the date line. Keep notes to one line.

---

## How it all fits, in plain English

1. **Senders sign.** The Canary box (Tisya's, not built yet), residents' phones and the simulation each hold their own key and sign every alert. Phones get onto the roster in person by showing a QR code to an operator.
2. **Hubs check.** Two hubs (L34 and L12) refuse anything not signed by a key on the roster, anything replayed, and anything stale. Every refusal is counted ("forgeries blocked").
3. **Hubs remember.** Each hub chains every record to the one before it, so an edit is caught at the exact row, and keeps a list of what it wrote, so a deleted row comes back from the other hub.
4. **Hubs sync.** They swap events over one link. Cut it and alerts wait; restore it and all arrive, none twice. A fingerprint shows both hold the same events.
5. **AI sorts.** A small model on the hub (offline) reads free text and pulls out the facts; code turns them into a priority, so the most urgent message crosses a slow link first.
6. **Cells stay private.** Members' messages are encrypted on the phone; hubs carry them without reading them.
7. **People see it.** `/overview` explains it and proves each beat live; the console, the 3D map and the Directorate view show the same data from different sides. Anything simulated is labelled.

## Where the demo stands

The demo is done when all five beats work on the flat console.

| Demo beat | Status |
|---|---|
| 1. Water touches the probe on level 34's box; the alert lands on the other hub with a "verified" badge | ❌ No box code pushed yet (`tisya/canary-box` has nothing new since Tue). The hub side is ready. **Fallback if the box misses the video:** the sim's boxes (tagged "Simulated") plus a phone filing a signed "I need help" check-in show the same path: signed, checked, synced, verified on the other hub |
| 2. The Directorate cuts the link; alerts queue and all arrive on reconnect, none duplicated | ✅ Hub side merged (PRs #14, #19): 200 of 200 alerts on both hubs after 26 random cuts, 0 duplicates. Tested by hand on `/dashboard`: during a cut the sending hub shows "3 waiting to send" and none arrive; after restore all arrive. The console now shows the sending hub's backlog (PR #21) |
| 3. A forged "all clear" is rejected and the "forgeries blocked" counter goes up | ✅ Hub side done: 0 of 300 forged and replayed messages accepted, all counted in `GET /rejected`. The console's "forgeries blocked" counter is in (PR #21) |
| 4. An edited record: the chain check points to the exact row | ✅ Hub side done: 160 of 160 edits to the database caught at the exact row by `GET /events/verify`, deleting the newest row included; a deleted row comes back from the other hub in about 1 s. The console's chain check names the edited row (PR #21) |
| 5. The Directorate sniffs the channel: cell messages are gibberish, public alerts readable | ✅ Real cell messages now: `web/lib/cell.ts` and the `/cell` page encrypt on the phone, and `/truth` shows them as bytes. A second phone opens them after scanning the invite QR. *(Live, `/truth` now shows only real traffic; its demo message appears only when no hub answers.)* |

**Tuesday-night checkpoint (the channel works between two hubs):** the signed-event schema, the hub checks and sync are merged. Since then the console, Directorate view and 3D map are in (PR #21), and sync puts a hub's deleted rows back from the other hub (number 2 is now 160 of 160). On Thursday, phone signing, cell messages and the simulation went in too. Still open: the box.

**Blocking the most people:**
1. **The Canary box (Tisya).** Beat 1 and headline number 4 need it, and it's the one piece that can't move to someone else.
2. **A full phone run (Michael and Taheful).** Two phones on the hotspot: join, all 4 reports signed, a cell message both ways, the sim, then revoke a phone.
3. **The video (Taheful, today).** Script, rehearse twice, record on a production build, not `next dev`.

**Judges' front door (Thu, Michael; front end only):** `/overview` explains the project, shows how one alert travels, and walks the five beats with live proof from the hubs and the exact command for each. A shared top bar on every laptop page (Overview · Console · Map · Directorate view · Phones) shows both hubs, the link, "hubs agree", forgeries blocked, the chain and signing, and keeps `?hub=&peer=` across pages. Built with shadcn/ui (`web/components/ui/`), lucide icons and sonner toasts; the shadcn colours map onto the existing tokens, so nothing else changes colour. *(Taheful: only your old nav links were swapped for the bar in `/dashboard`, `/truth` and the Hollow `TopBar`/`CityApp`.)* The Hollow map now uses the same dark theme (its light `.theme-paper` tokens are kept, unused). The phone pages (home, the 4 reports, `/join`, `/cell`) got the same look: wordmark bar with a hub/signing chip, icons, cards and the shared buttons; no logic changed. Demo clean-up: `/truth` shows its labelled demo cell message only when no hub answers; the map's "Test a sensor alert" panel appears only with `?test=` in the address; the Directorate's figures are labelled as the simulation's bulletin (same numbers as `sim/world.json`). Question 13: `/overview` has "Is the surface safe?", the Directorate's claim next to the newest signed reading from the (simulated) surface box, and the map's Briefs tab shows #13 as live once the sim runs. `/overview` also has "How the hub decides what's urgent": type a messy message, the hub's AI triage (`POST /triage`) ranks it live and shows the extracted facts, the priority, where it lands in the queue and which model read it (or "keyword rules" when none is reachable), next to the measured triage numbers.

**Web setup (merged, PR #12):** every web dependency is in at an exact version (tweetnacl, three, the react-three libraries, react pinned to 19.3.1), plus `listRejected()` and `getRoster()` in `web/lib/hub.ts`. Run `npm install` in `web/`. Nobody adds a dependency without posting first. *(Thu: `qrcode-generator` 1.4.4 added for the QR codes on `/join` and `/cell`, and `three-stdlib` 2.36.1 pinned directly, since the map imports it and it only came in through drei. Then shadcn's: Radix tabs, tooltip, dialog and slot, `lucide-react` 1.67.0, `sonner` 2.0.8, `class-variance-authority`, `clsx`, `tailwind-merge`.)*

**Working branches:** renamed Tue 11/17 for the rework, all starting from that day's `main`. The old ones are deleted.

| Person | Branch |
|---|---|
| Tisya | `tisya/canary-box` |
| Michael | `michael/sync` |
| Alanna | `alanna/phones-and-sim` |
| Taheful | `taheful/hollow-layout` |

To switch: `git fetch --prune && git checkout <your branch>`, then `git branch -D <your old branch>`. Then run `npm install` in `web/` and `pip install -r hub/requirements.txt`.

**Who touches which files:** `hub/` and `eval/` Michael · `firmware/` and `bridge/` Tisya · `sim/`, the phone pages, `web/lib/hub.ts`, `sign.ts` and `cell.ts` Alanna · `web/app/dashboard`, `truth`, `hollow`, `layout.tsx` and `globals.css` Taheful. Ask the owner before changing someone else's file.

---

## Tisya: the Canary box

- [ ] Email PhysicalComputing@umass.edu to confirm parts, then the makerspace run: bin parts, a PC fan, and check for an air sensor.
- [ ] UNO Q setup: App Lab, Wi-Fi, blink an LED, hello-world Python app.
- [ ] SOS button, LED and buzzer, then the water probe (3 seconds past threshold before alerting).
- [ ] Hub on the board: install `hub/requirements.txt` only (no torch now), with `TRIAGE_ON_INGEST=0`.
- [ ] Bridge: readings from the sketch to Python on the board.
- [ ] `bridge/canary_bridge.py`: sign each alert with `crypto.sign` and post it to the hub on the board.
- [ ] Temperature, then the fan monitor if there's time.
- [ ] Film the box shots.
- [ ] Review the sync PR.

**Done when:** water on the probe makes a verified alert appear on the other hub, on camera.

---

## Michael: channel core, sync and numbers

- [x] Schema: the signer sets `id`, `created_at` and `hub_id`; new fields `author_pub`, `sig`, `source`, `device_id`; new `roster` event type. *(PR #10.)*
- [x] Hub checks: signature, roster and replay on `POST /events`; `GET /rejected`, `GET/POST /roster`; `gate.admit(event, fresh=False)` for sync. *(71 tests pass; checked against a running hub.)*
- [x] `hub/requirements.txt` split: hub + `pynacl`; torch and transformers moved to `hub/requirements-ai.txt`.
- [x] `web/lib/canonical.ts`: the JS side of signing, checked against Python with tweetnacl.
- [x] Labels: all 200 test messages reviewed. Tuned "urgent" on the 51 tuning messages only, then froze the prompt.
- [x] Final held-back triage run (149 messages): keyword rules, local model and Gemini.
- [x] Web setup: every web dependency at an exact version, plus `listRejected()` and `getRoster()`. *(PR #12.)*
- [x] Sync: one chain per origin hub, `sync.py`, cuts that hold events back, stress test. *(PR #14. Run two hubs with `HUB_PEERS`; see the top of `hub/app/main.py`.)*
  - *PR #19: while cut, the backlog shows in `GET /link` ("waiting to send") and drains on restore. Tested by hand with two hubs and the dashboard.*
- [x] Attack script: forge, replay, impersonate, tamper, stale and wrong-hub messages, roster grabs, attacks over sync, and direct edits to the database. *(PR #15, `eval/run_attacks.py`. It also found and closed one gap: sync now refuses events that claim to come from the receiving hub.)*
- [ ] Security eval, the four headline numbers:
  - *1. Forged and replayed messages accepted: **0 of 300** (95% upper bound 1.0%); all 40 real member alerts accepted.*
  - *2. Edited records caught at the exact row: **160 of 160** (95% upper bound on misses 1.9%), now including deleting the newest row. Deleted rows put back by the other hub: **20 of 20**, counter unmoved. Known limits, not counted: changing `priority`, and deleting the newest row together with the hub's own record of writing it.*
  - *3. Alerts delivered after random link cuts: **200 of 200**, 0 duplicates (simulated cuts).*
  - *4. Probe to the alert on the other hub: dry run with a simulated canary, **0.81 s** median (30 of 30 arrived). The real run waits on the box: `eval/run_probe_latency.py --real`.*
- [x] Sync fix: a row deleted from a hub came back as a refusal every second, so the "forgeries blocked" counter climbed by 1 a second. Now the other hub puts the row back (only if this hub wrote exactly that event), and any refusal over sync is counted once and not resent. *(104 tests pass.)*
- [x] Demo tools: `hub/scripts/roster_tool.py` (operator key, roster file, add or remove a member on a running hub) and `hub/scripts/demo_hubs.py` (start, reset and stop both hubs together). *The sim's 12 keys are on the demo roster (`sim/simulate.py roster`). Still needed: Tisya, the box's public key.*
- [x] Live Directorate script, `hub/scripts/directorate.py`: forge, replay, tamper, edit, delete, cut and restore, each one real attack on the running hubs so the console reacts on screen; plus the stolen-phone moment (accepted → revoked → refused on both hubs). *Taheful: no new endpoints; run it in a terminal next to the console.*
- [x] "Hubs agree" fingerprint: `fingerprint` in `GET /health`, and `agrees_with` in `GET /sync/status`. The two match after a cut and reconnect. *Taheful: show it on the console if you want.*
- [x] Blackout forecast (question 1): `hub/app/forecast.py` fits a line through a relay box's last 8 signed voltage readings and, when the fall is clear of the noise, predicts when it reaches 180 V, with a range (`GET /forecast`). The sim's L12 relay now reports its voltage as it sags, and its blackout warnings carry the same forecast as their countdown. Backtest on 1,000 synthetic sags (`eval/run_forecast_eval.py`): off by 6 min an hour ahead vs 27 min for a two-reading guess, 99.6% of sags warned before they drop out, 0% false alarms on steady power (35% for the guess). `/overview` shows it live with the trend drawn to the cutoff.
- [x] Have / Need board (questions 2, 6, 10, 12): a new signed event type, `exchange`. Residents post what they can spare or need (space, food, water, medicine, power); `GET /exchange` (`hub/app/exchange.py`) works out what's open and pairs each need with the nearest offer of the same kind, medicine and water first, then the longest-waiting; only the key that posted can close a post. Phone page `/exchange`, a live section on `/overview`, and the map's Briefs 6 and 12 are live. The sim posts 7 simulated needs and offers (3 matched, 1 left waiting). *(6 unit tests + the real-process sim test; checked end to end with a phone closing its own post and failing to close someone else's.)*
- [x] Sleep and mood (question 11) and a roll call (question 8): the daily check-in asks two optional questions, hours slept and mood 1-5 (whole numbers). `GET /wellbeing` (`hub/app/wellbeing.py`) averages each person's latest answer per level, only once 2+ people answered so nobody is singled out, and lists residents heard from this week but not today. Live on `/overview` and in the map's Briefs #11; the console's summary shows "slept 5 h · mood 2/5". The sim's check-ins carry answers: L34 and L35 sleep about 4 h, L12 about 7. *(4 unit tests + the real-process sim test; a phone's signed check-in moved L12's average end to end.)*
- [x] Design notes for questions 14 and 15 (going back up), labelled "Design · not built": a Canary box in every trial suit, dome and outpost, compared on signed readings with the forecast flagging one heading toward unsafe; the move planned from the signed census, signed surface readings, outpost beds on the Have / Need board and the roll call. On `/overview` with the live inputs they'd start from, and in the map's Briefs, which now lists all 15 questions (#15 was missing).
- [x] `/pitch`, the 3-minute presenter mode (the video limit went up): 8 full-screen slides, 180 s in all: the stakes · the answer · the Canary box · attack it live · AI triage and the forecast · Have / Need, sleep and the surface · the 15 questions · the numbers, stack and team. Each slide has a live component from `/overview`, a takeaway line at its foot, and its purpose plus narration in the speaker notes (N). Arrow keys / Space, 1-8, P to auto-play on the planned times, F for full screen, a timer against 3:00. Words in `web/app/pitch/slides.ts`. **"Who built what" is a placeholder: fill in `TEAM` in that file before recording.**
- [x] Clarity pass on the laptop pages, for judges: one shared header (`web/components/page-intro.tsx`) naming the page, the questions it answers, one claim and its key numbers. Console: numbered zones (who needs help, under attack, the link, the record, people). Map: a one-line header with a colour legend. Directorate view: the header and labelled wire / phone columns. Overview: a "Watch the 2-minute pitch" button, the 15 questions as a clickable index, a sticky section bar, question numbers on every section. Layouts, data and controls unchanged. README rewritten for the whole system. Fixes: live pop-ups no longer announce old refusals when a page opens; the phone pages' logo leads back to the overview.
- [x] Independent audit, `hub/scripts/verify.py` ("don't trust the hub, check it"): imports none of the hub's code (stdlib + PyNaCl). Checks a live hub, a database file or an export against the roster you hold: every hash and signature, each signer on the roster *when it signed* (roster changes count only if an operator signed them), forks, deleted rows (the newest too, from a database file), and two hubs event by event. `--save` exports, `--json --sign-key` writes a report signed by the auditor, `--check-report` verifies it. Both demo hubs pass with matching fingerprints; an edit on a copy fails at its row. *(11 tests; 149 hub tests pass.)*
- [x] Livability Index (question 3, now live): `GET /livability` (`hub/app/livability.py`) gives each level a 0-100 score from eight dimensions (flooding, water, air, heat, power with the blackout forecast, health, unmet needs, sleep and mood), by plain rules from signed events only. "No data" never counts as fine, one dimension under 25 caps the level at unsafe, and every number lists its events. On the sim it ranks L34 (unsafe, CO₂) < L35 (flood) < L12 (relay) < surface, the same order as the hidden truth. Live on `/overview` (click a level for each number's source). *(8 unit tests + the real-process sim test; 157 hub tests pass.)* *Map owners: Briefs #3 still says "heat"; it could point at the index.*
- [x] Directorate gym, `eval/run_directorate_gym.py`: adaptive attackers against the real gate, each episode on a fresh copy of a golden hub, thrown away after. A seeded fuzzer (parallel processes, ~1,000 attempts/s, replays identical from the seed) and a local LLM playing the Directorate that sees every refusal reason. Scored by an oracle outside the hub's checks, after one sync round. **2,000 + 20 episodes, 40,156 attempts, 0 breaches; reset 0.9 ms median, 2,020 of 2,020 identical.** It found two things: (1) a row edited to level 999999 crashed the chain check and every page listing events; fixed in `log.py` and `verify.py`, with a test; (2) deleting the *other* hub's rows is unseen by one hub alone and put back by sync; now in the README's limits. *(6 tests + 1 regression test; 164 hub tests pass.)*
- [x] CI (`.github/workflows/ci.yml`, badge in the README): every push runs the hub tests, a 200-episode Directorate gym that fails on any breach (about 10 s), and the web app's types and tests. Checked in a fresh clone: 170 hub tests and 42 web tests pass.
- [x] Link lock: `POST /link` (cut the network, bandwidth) answers only the hub's own machine, by loopback or by the laptop's own Wi-Fi address, so nobody else on the Wi-Fi can cut the link through the API (403). `directorate.py`, the console and the stress test all run on the laptop and still work; `LINK_CONTROL=open` lifts it. Running hubs need `demo_hubs.py down` then `up` to get it. *(6 tests.)*
- [x] Model card (`MODEL_CARD.md`, linked from the README): what triage may do (fill in a fixed form) and may not (do math, invent a number, hide or refuse a report); the priority formula; the 149 held-back test numbers for Llama, Phi-4, Gemini and keywords; why the hub runs Llama; limits stated plainly (1 in 4 urgency calls wrong, 27% of fakes caught and why signatures cover that, dev-to-test drop); fairness, privacy, the off switch; how to reproduce. For Microsoft's responsible-AI judging.
- [ ] Number 3 with the plug really pulled: `eval/run_sync_stress.py --real` is ready (dry-run tested on one laptop). Needs two laptops on the same Wi-Fi on Wed. *(Keep the simulated 200 of 200 as the stress test.)*
- [x] `REQUIRE_SIGNED=1` works end to end: `demo_hubs.py up --signed --roster demo/roster.json --host 0.0.0.0` (it prints the phone link), phones join with `roster_tool.py add`, and the sim's events all verify. *(Rehearsed on spare ports: 31 signed events on both hubs, 0 refused. A real phone joined over the hotspot.)*
- [ ] Results slide; practice answering "how do you know it works?" *(Deck drafted with the practice answer in its notes; the real number 4 goes in Wed.)*

**Triage numbers (149 held-back messages, final; supporting numbers in the rework):**

| Model | Urgency accuracy | SOS ranked first | SOS recall | Fakes caught |
|---|---|---|---|---|
| llama3.2:3b, local | 76% [69, 83] | 62% [52, 71] | 88% | 27% |
| Keyword rules only | 54% | 37% | 27% | 27% |
| Gemini, cloud (online mirror only) | 88% [83, 93] | 84% [74, 92] | 88% | 64% |
| phi4-mini, local (tested 11/20, not adopted) | 77% [70, 84] | 55% [46, 64] | 91% | 9% |

The priority queue cuts SOS delay by 72% against first-come-first-served on the slow link (simulated arrivals). Full table: [`eval/results/RESULTS.md`](eval/results/RESULTS.md). **The pitch and overview now quote 76% (the offline model the hub runs), not Gemini's 88%.**

---

## Alanna: phones, simulation, and the backup board

- [ ] By Tue night: test your board (blink an LED, read a button, read an analog pin) and post whether it works and has Wi-Fi.
  - *If it works: build the Directorate kill switch (a button that calls `POST /link`). If Tisya's board fails: it becomes the Canary box.*
- [x] All 4 phone forms work end to end at phone width. *(Built by Michael; restyle anything. PR #19 fixed a hydration error from the random handle in `web/components/phone.tsx`: pull `main`.)*
- [x] `web/lib/sign.ts`: a keypair on first visit, kept in the browser; fetch `hub_id` from `GET /health`; sign every report with `canonicalBytes`. All 4 forms sign once the phone's key is on the roster, and post unsigned ("not verified") until then while the hub allows it. `/join` shows the public key and whether it's on the roster. *(Michael, while Alanna was out. A JS-signed report verifies in the hub's Python, and a real hub with `REQUIRE_SIGNED=1` accepts it. `/join` shows the key as a QR code too; `?hub=URL` on any phone page picks the hub and is remembered, and `demo_hubs.py up --host 0.0.0.0` prints that link.)*
- [x] `web/lib/cell.ts` (`{enc, nonce, ciphertext}`, tweetnacl secretbox, the shape `/truth` already reads) and the `/cell` page: send encrypted, read your cell's messages, and invite in person with a `/cell#k=…` link (the key never reaches a server). *(Michael. Taheful: `/truth` can now open real cell messages with `decrypt` + `loadCellKey` in place of its demo key; the Hollow Briefs and Feed count encrypted `case` events as sick people, so filter `severity !== "message"` there.)*
- [ ] Test on a real phone. *(Started: a phone loaded the pages over the hotspot and was added to the roster. Fixed on the way: the setup link's `?hub=` wasn't saved on the home page. The full run with two phones is next.)*
- [x] `sim/world.json`: hub-L34 and hub-L12 (serving L31–40 and L1–30), 4 simulated canaries on the map's mounts plus a surface box at the top of the shaft, 8 residents, a 47-event crisis timeline (relay voltage readings, 7 Have / Need posts, and check-ins with sleep and mood), the hidden ground truth and the Directorate's claims. *(Michael.)*
- [x] `sim/simulate.py`: `keys`, `roster`, then `run` fills both hubs with 47 signed, verified events in 3 minutes (water on L35 → bad water on L34 → the L34 market fan stalls → L12 blackout warning); `truth` writes `sim/ground_truth/`. See `sim/README.md`. *(Michael. 5 tests against real hubs.)* Every sim event carries `"simulated": true` inside its signed payload, and the console, the Directorate view and the map tag it "Simulated", so a sim box is never taken for Tisya's real one.

**Done when:** a phone files every report type signed, and one command fills two hubs with signed alerts.

---

## Taheful: console, Directorate view, map, video

- [x] `/dashboard` is live: priority queue, SOS flash, missing-persons search, bandwidth slider, cut button.
- [x] Rebel console: "verified" badges, a "forgeries blocked" counter, a Directorate-view toggle, plus the sending hub's backlog and the chain check naming the tampered row. *(PR #21; tested against two real hubs.)*
- [x] Directorate view (`/truth`): wire bytes next to what a member reads. *(One labeled demo cell message until `cell.ts` lands; then it shows real ones.)*
- [x] Fonts: Geist sans + mono in `layout.tsx`; tokens in `globals.css`.
- [x] The Hollow map (`/hollow`), rebuilt as a city map: one level at a time with real street and building layouts (generated), a "What's happening" bubble in plain words, flood alerts that close streets and draw the safest route, bad-water reports traced up the pipes to a likely source (a guess, labelled), cough/breathing reports and check-ins per level, way to the nearest care from any building, add-a-level. Starts with L12, L34, L35. *(PR #28. No beat depends on it.)*
- [x] `/hollow` organized and sensor-ready *(PR #29)*: three columns, a **Briefs** tab answering all 14 questions with live status and "Show me", bad air / heat / blackout on the map (one table in `sensors.ts`, boxes one line each in `model.ts`), test alerts (`?test=bad_air,blackout_soon,heat,surface`), Directorate-vs-residents counts, find someone, needs-care list, outage ledger. 35 tests pass. *(The hub accepts the bad_air, heat and blackout alerts with their reading fields; checked against two running hubs. Test alerts never reach a hub.)*
- [x] The web app stops polling a hub that has never answered. *(PR #30.)*
- [ ] Check every page at phone width. *(Console, `/truth` and `/hollow` checked; phone forms are Alanna's.)*
- [ ] Demo script, two rehearsals, record and edit the video (Thu 11/19).
- [ ] Devpost: story, how it works, results, what it doesn't do. Submit early Fri 11/20.

**Done when:** all five beats can be read on the console, and the video and Devpost are submitted.

---

## Open questions between people

- **Tisya:** is the box going to make the video? If not, say so in the chat now and we film beat 1 with the sim plus a phone SOS (see the beat table).
- **Everyone:** the video length limit and the submission deadline (judging closes Fri 11/20 11:59 PM EST).
- **Keep or cut:** the judges' online mirror, and photos with the encrypted medical card. Neither is built; both go under "future work" unless someone picks them up.
- **Sign-off:** each person ticks their box in the reworked team contract once they've read it.
- ~~Level pair~~: L34 and L12. ~~`pip install` for pynacl~~: done.
