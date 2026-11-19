# Team status

**Last updated:** Thu 11/19 (evening, after the judges' overview, the shared top bar and one theme across every page) by Michael
**Based on:** what's in the repo (`main` plus pushed branches). If you've done work that isn't pushed, it isn't counted here. Push it, or edit your section.

The plan is now the rework: the Canary box plus a signed, encrypted channel ([`REWORK_PLAN.md`](REWORK_PLAN.md)). Tasks below come from the reworked team contract, one section per person. `[x]` means done and merged into `main`. Anything partly done stays unchecked, with a note saying what's left.

**How to update:** edit only your own section when you finish something. Michael updates the date line. Keep notes to one line.

---

## Where the demo stands

The demo is done when all five beats work on the flat console.

| Demo beat | Status |
|---|---|
| 1. Water touches the probe on level 34's box; the alert lands on the other hub with a "verified" badge | ❌ The box isn't started. The hub side is ready: it checks the signature and the roster before storing anything |
| 2. The Directorate cuts the link; alerts queue and all arrive on reconnect, none duplicated | ✅ Hub side merged (PRs #14, #19): 200 of 200 alerts on both hubs after 26 random cuts, 0 duplicates. Tested by hand on `/dashboard`: during a cut the sending hub shows "3 waiting to send" and none arrive; after restore all arrive. The console now shows the sending hub's backlog (PR #21) |
| 3. A forged "all clear" is rejected and the "forgeries blocked" counter goes up | ✅ Hub side done: 0 of 300 forged and replayed messages accepted, all counted in `GET /rejected`. The console's "forgeries blocked" counter is in (PR #21) |
| 4. An edited record: the chain check points to the exact row | ✅ Hub side done: 160 of 160 edits to the database caught at the exact row by `GET /events/verify`, deleting the newest row included; a deleted row comes back from the other hub in about 1 s. The console's chain check names the edited row (PR #21) |
| 5. The Directorate sniffs the channel: cell messages are gibberish, public alerts readable | ✅ Real cell messages now: `web/lib/cell.ts` and the `/cell` page encrypt on the phone, and `/truth` shows them as bytes. A second phone opens them after scanning the invite QR. *(Taheful: `/truth` still adds its demo message; it can open real ones with `decrypt` + `loadCellKey`.)* |

**Tuesday-night checkpoint (the channel works between two hubs):** the signed-event schema, the hub checks and sync are merged. Since then the console, Directorate view and 3D map are in (PR #21), and sync puts a hub's deleted rows back from the other hub (number 2 is now 160 of 160). On Thursday, phone signing, cell messages and the simulation went in too. Still open: the box.

**Blocking the most people:**
1. **The Canary box (Tisya).** Beat 1 and headline number 4 need it, and it's the one piece that can't move to someone else.
2. **A full phone run (Michael and Taheful).** Two phones on the hotspot: join, all 4 reports signed, a cell message both ways, the sim, then revoke a phone.
3. ~~The level pair~~: L34 and L12, now in `sim/world.json` too.

**Judges' front door (Thu, Michael; front end only):** `/overview` explains the project, shows how one alert travels, and walks the five beats with live proof from the hubs and the exact command for each. A shared top bar on every laptop page (Overview · Console · Map · Directorate view · Phones) shows both hubs, the link, "hubs agree", forgeries blocked, the chain and signing, and keeps `?hub=&peer=` across pages. Built with shadcn/ui (`web/components/ui/`), lucide icons and sonner toasts; the shadcn colours map onto the existing tokens, so nothing else changes colour. *(Taheful: only your old nav links were swapped for the bar in `/dashboard`, `/truth` and the Hollow `TopBar`/`CityApp`.)* The Hollow map now uses the same dark theme (its light `.theme-paper` tokens are kept, unused). The phone pages (home, the 4 reports, `/join`, `/cell`) got the same look: wordmark bar with a hub/signing chip, icons, cards and the shared buttons; no logic changed.

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
- [ ] Number 3 with the plug really pulled: `eval/run_sync_stress.py --real` is ready (dry-run tested on one laptop). Needs two laptops on the same Wi-Fi on Wed. *(Keep the simulated 200 of 200 as the stress test.)*
- [x] `REQUIRE_SIGNED=1` works end to end: `demo_hubs.py up --signed --roster demo/roster.json --host 0.0.0.0` (it prints the phone link), phones join with `roster_tool.py add`, and the sim's events all verify. *(Rehearsed on spare ports: 31 signed events on both hubs, 0 refused. A real phone joined over the hotspot.)*
- [ ] Results slide; practice answering "how do you know it works?" *(Deck drafted with the practice answer in its notes; the real number 4 goes in Wed.)*

**Triage numbers (149 held-back messages, final; supporting numbers in the rework):**

| Model | Urgency accuracy | SOS ranked first | SOS recall | Fakes caught |
|---|---|---|---|---|
| llama3.2:3b, local | 76% [69, 83] | 62% [52, 71] | 88% | 27% |
| Keyword rules only | 54% | 37% | 27% | 27% |
| Gemini, cloud (online mirror only) | 88% [83, 93] | 84% [74, 92] | 88% | 64% |

The priority queue cuts SOS delay by 72% against first-come-first-served on the slow link (simulated arrivals). Full table: [`eval/results/RESULTS.md`](eval/results/RESULTS.md).

---

## Alanna: phones, simulation, and the backup board

- [ ] By Tue night: test your board (blink an LED, read a button, read an analog pin) and post whether it works and has Wi-Fi.
  - *If it works: build the Directorate kill switch (a button that calls `POST /link`). If Tisya's board fails: it becomes the Canary box.*
- [x] All 4 phone forms work end to end at phone width. *(Built by Michael; restyle anything. PR #19 fixed a hydration error from the random handle in `web/components/phone.tsx`: pull `main`.)*
- [x] `web/lib/sign.ts`: a keypair on first visit, kept in the browser; fetch `hub_id` from `GET /health`; sign every report with `canonicalBytes`. All 4 forms sign once the phone's key is on the roster, and post unsigned ("not verified") until then while the hub allows it. `/join` shows the public key and whether it's on the roster. *(Michael, while Alanna was out. A JS-signed report verifies in the hub's Python, and a real hub with `REQUIRE_SIGNED=1` accepts it. `/join` shows the key as a QR code too; `?hub=URL` on any phone page picks the hub and is remembered, and `demo_hubs.py up --host 0.0.0.0` prints that link.)*
- [x] `web/lib/cell.ts` (`{enc, nonce, ciphertext}`, tweetnacl secretbox, the shape `/truth` already reads) and the `/cell` page: send encrypted, read your cell's messages, and invite in person with a `/cell#k=…` link (the key never reaches a server). *(Michael. Taheful: `/truth` can now open real cell messages with `decrypt` + `loadCellKey` in place of its demo key; the Hollow Briefs and Feed count encrypted `case` events as sick people, so filter `severity !== "message"` there.)*
- [ ] Test on a real phone. *(Started: a phone loaded the pages over the hotspot and was added to the roster. Fixed on the way: the setup link's `?hub=` wasn't saved on the home page. The full run with two phones is next.)*
- [x] `sim/world.json`: hub-L34 and hub-L12 (serving L31–40 and L1–30), 4 simulated canaries on the map's mounts, 8 residents, a 26-event crisis timeline, the hidden ground truth and the Directorate's claims. *(Michael.)*
- [x] `sim/simulate.py`: `keys`, `roster`, then `run` fills both hubs with 26 signed, verified events in 3 minutes (water on L35 → bad water on L34 → the L34 market fan stalls → L12 blackout warning); `truth` writes `sim/ground_truth/`. See `sim/README.md`. *(Michael. 5 tests against real hubs.)*

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

- **Everyone, now:** run `pip install -r hub/requirements.txt` again; it adds `pynacl`. Torch is no longer in it.
- **Everyone:** pick the level pair (L34/L12 or L38/L12) in the chat.
- **Everyone:** check the Discord for the submission deadline and the video length limit.
- **Keep or cut:** the judges' online mirror, and photos with the encrypted medical card. Both were in the old contract; the rework plan doesn't mention them.
- **Sign-off:** each person ticks their box in the reworked team contract once they've read it.
