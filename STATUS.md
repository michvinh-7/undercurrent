# Team status

**Last updated:** Tue 11/17 (night) by Michael
**Based on:** what's in the repo (`main` plus pushed branches). If you've done work that isn't pushed, it isn't counted here. Push it, or edit your section.

The plan is now the rework: the Canary box plus a signed, encrypted channel ([`REWORK_PLAN.md`](REWORK_PLAN.md)). Tasks below come from the reworked team contract, one section per person. `[x]` means done and merged into `main`. Anything partly done stays unchecked, with a note saying what's left.

**How to update:** edit only your own section when you finish something. Michael updates the date line. Keep notes to one line.

---

## Where the demo stands

The demo is done when all five beats work on the flat console.

| Demo beat | Status |
|---|---|
| 1. Water touches the probe on level 34's box; the alert lands on the other hub with a "verified" badge | ❌ The box isn't started. The hub side is ready: it checks the signature and the roster before storing anything |
| 2. The Directorate cuts the link; alerts queue and all arrive on reconnect, none duplicated | 🟡 Hub side merged (PR #14): two real hubs, 200 of 200 alerts on both after 26 random cuts, 0 duplicates. Needs the console to show it |
| 3. A forged "all clear" is rejected and the "forgeries blocked" counter goes up | 🟡 Hub side done: 0 of 300 forged and replayed messages accepted, all counted in `GET /rejected`. The console counter isn't built |
| 4. An edited record: the chain check points to the exact row | 🟡 Hub side done: 140 of 140 edits to the database caught at the exact row by `GET /events/verify`. The console display isn't built |
| 5. The Directorate sniffs the channel: cell messages are gibberish, public alerts readable | ❌ Only the encrypted payload shape is defined (`{enc, nonce, ciphertext}`) |

**Tuesday-night checkpoint (the channel works between two hubs):** the signed-event schema, the hub checks and sync are merged. Still open: phone signing, the simulation, the console badges, and the minimum box.

**Blocking the most people:**
1. **The Canary box (Tisya).** Beat 1 and headline number 4 need it, and it's the one piece that can't move to someone else.
2. **The console (Taheful).** Beats 2, 3 and 4 work on the hub; they need the console to show them.
3. **The level pair.** L34/L12 (rework plan) or L38/L12 (`sim/world.json`, the `HUB_ID` default). Pick it in the chat before anyone writes it in code.

**Web setup (merged, PR #12):** every web dependency is in at an exact version (tweetnacl, three, the react-three libraries, react pinned to 19.3.1), plus `listRejected()` and `getRoster()` in `web/lib/hub.ts`. Run `npm install` in `web/`. Nobody adds a dependency without posting first.

**Working branches:** renamed Tue 11/17 for the rework, all starting from that day's `main`. The old ones are deleted.

| Person | Branch |
|---|---|
| Tisya | `tisya/canary-box` |
| Michael | `michael/sync` |
| Alanna | `alanna/phones-and-sim` |
| Taheful | `taheful/console` |

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
- [x] Attack script: forge, replay, impersonate, tamper, stale and wrong-hub messages, roster grabs, attacks over sync, and direct edits to the database. *(PR #15, `eval/run_attacks.py`. It also found and closed one gap: sync now refuses events that claim to come from the receiving hub.)*
- [ ] Security eval, the four headline numbers:
  - *1. Forged and replayed messages accepted: **0 of 300** (95% upper bound 1.0%); all 40 real member alerts accepted.*
  - *2. Edited records caught at the exact row: **140 of 140** (95% upper bound on misses 2.1%). Known limits, not counted: changing `priority`, and deleting the newest row (sync restores it from the other hub).*
  - *3. Alerts delivered after random link cuts: **200 of 200**, 0 duplicates (simulated cuts).*
  - *4. Probe to the alert on the other hub: dry run with a simulated canary, **0.81 s** median (30 of 30 arrived). The real run waits on the box: `eval/run_probe_latency.py --real`.*
- [ ] Turn on `REQUIRE_SIGNED=1` once the phones sign.
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
- [x] All 4 phone forms work end to end at phone width. *(Built by Michael; restyle anything.)*
- [ ] `web/lib/sign.ts`: a keypair on first visit, kept in the browser; fetch `hub_id` from `GET /health`; sign every report with `canonicalBytes`.
- [ ] `web/lib/cell.ts` first (encrypted payload shape, encrypt and decrypt), posted in the chat; then the cell message page.
- [ ] Test on a real phone.
- [ ] `sim/world.json` with the agreed level pair (it still has scaffold placeholders).
- [ ] `sim/simulate.py`: simulated canaries and residents on other levels, each with its own key, preloaded through `ROSTER_FILE`. *(Stub only; `feature/simulation` is an empty "dummy push".)*

**Done when:** a phone files every report type signed, and one command fills two hubs with signed alerts.

---

## Taheful: console, Directorate view, map, video

- [x] `/dashboard` is live: priority queue, SOS flash, missing-persons search, bandwidth slider, cut button.
- [ ] Rebel console: "verified" badges, a "forgeries blocked" counter from `listRejected()`, a Directorate-view toggle. Build against fake events first.
- [ ] Directorate view (`web/app/truth`, a placeholder today): ciphertext next to plaintext, in monospace.
- [ ] Fonts: one `next/font` sans and one mono in `layout.tsx`; CSS tokens on the console pages.
- [ ] Bonus: the 3D Hollow map (`web/app/hollow`), loaded with `next/dynamic` and `ssr: false`. Ship or cut at Wed noon.
- [ ] Check every page at phone width.
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
