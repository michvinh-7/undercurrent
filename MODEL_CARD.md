# Model card: Undercurrent's triage model

**What it is:** a small language model on each hub reads a resident's report and fills in a fixed form. Plain code turns that form into a priority. The model never does arithmetic, never decides what is true, and never stops a report from being delivered.

| | |
|---|---|
| Model on the hub | Llama 3.2 3B through Ollama, running offline on the hub's laptop. Temperature 0, JSON output only |
| Also measured | Phi-4 mini (offline) and Gemini 3.1 Flash-Lite (cloud, used only for the eval and an optional online mirror) |
| Code | [`hub/app/triage.py`](hub/app/triage.py) (model, checks, score), [`hub/app/ingest.py`](hub/app/ingest.py) (when it runs) |
| Eval | [`eval/run_triage_eval.py`](eval/run_triage_eval.py) on [`eval/messages_labeled.jsonl`](eval/messages_labeled.jsonl); full tables in [`eval/results/RESULTS.md`](eval/results/RESULTS.md) |
| Owner | Michael (AI and evaluation) |

---

## What it's for

On a slow or congested link between levels, the hub has to choose what goes first. Triage gives every incoming report a priority from 0 to 1, so "water rising, 3 kids trapped" crosses before "all good on 14".

- **It does:** pick an urgency (SOS, urgent, routine, or suspected fake), the report type, the level, how many people and how many are injured, and the hazard.
- **It doesn't:** delete, hide, edit or delay a report outright. Every report is signed and stored as the resident sent it, and every one is delivered. Priority only changes the order on a slow link.
- **Out of scope:** medical diagnosis (the medical organizer copies symptoms as reported and says "Documentation only. Not a diagnosis."), deciding whether an alert is genuine (the signatures decide that), and any action taken without a person.

## How it works: the model fills in a form, code does the rest

1. **The model fills in a strict form.** Only six fields are allowed: urgency, type, level (1 to 40), injuries, people count and hazard. Any other answer fails validation. The prompt says "never guess a number; if the message does not say it, use null".
2. **Code checks every number against the message.** If the model returns an injury count or a head count that the message doesn't state, in digits or words, it is set to blank. The model can't invent a casualty.
3. **Code computes the priority from a fixed formula, which is published:**

   | Urgency | Base | Then |
   |---|---|---|
   | SOS | 0.90 | +0.04 if anyone is injured |
   | Urgent | 0.65 | +0.03 if 3 or more people are involved |
   | Routine | 0.25 | +0.02 for flooding, collapse or bad air |
   | Suspected fake | 0.05 | no bonuses |

4. **If the model fails, keyword rules take over.** A broken or invalid answer gets one retry, then rules take over. So does a model that is down or takes more than 30 seconds. A report is never refused because the model failed. On the test set this happened for 2.7% of messages.
5. **The model can't change the evidence.** Triage runs after the signature check. The priority sits outside the signed fields on purpose, so the hub's ranking can never alter what the resident signed.

## Data

- **200 hand-labelled messages:** 43 SOS, 52 urgent, 75 routine, 30 fake. Typos, slang, panic, rumours and propaganda are included.
- **Split once, before any tuning:** 51 for tuning (dev) and **149 held back for reporting (test)**. The split is stratified by label (seed 2087).
- **Rule:** prompts, keyword rules and weights are tuned on dev only. Test is run to report numbers, never to decide changes.
- **Caveat:** the draft messages were written with Claude, which also wrote the keyword rules, and then every label was reviewed by a person. So the keyword numbers may be optimistic. The model numbers are the ones to quote.

## Results on the 149 held-back messages

Brackets are 95% bootstrap intervals.

| | **Llama 3.2 3B (on the hub)** | Phi-4 mini (offline) | Gemini (cloud) | Keyword rules |
|---|---|---|---|---|
| Urgency right | **75.8%** [68.5, 82.6] | 77.2% [69.8, 83.9] | 87.9% [82.6, 92.6] | 53.7% [45.6, 61.7] |
| SOS ranked first in a batch of 10 | **62.1%** | 55.1% | 84.1% | 37.1% |
| SOS found (recall) | **87.9%** [75.8, 97.3] | 90.9% | 87.9% | 27.3% |
| Flagged SOS that were SOS (precision) | **67.4%** [52.6, 81.0] | 65.2% | 93.5% | 100% |
| Fakes caught | **27.3%** [9.1, 47.4] | 9.1% | 63.6% | 27.3% |
| Level read exactly | **95.3%** | 91.9% | 98.0% | 63.1% |
| Fell back to keywords | **2.7%** | 6.0% | 9.4% | 100% |
| Seconds per message | **1.9** | 2.4 | 3.4 | 0.0 |
| SOS delay cut vs first-come-first-served (simulated arrivals) | **72.4%** | 64.2% | 75.9% | 29.8% |

**Why the hub runs Llama, not Phi-4 or Gemini:**
- **Phi-4 mini:** a statistical tie on urgency. It ranks SOS first less often, catches fewer fakes, falls back more and is slower.
- **Gemini:** better, but it needs the internet, which the Directorate controls. The hub stays offline.

## Limits, stated plainly

- **About 1 in 4 urgency calls is wrong.** Most misses are urgent reports: it finds only 58% of them, calling the rest SOS or routine. It never misses a routine one (100%). The cost is order on a slow link, not loss: every report still arrives.
- **One in three reports it flags as SOS isn't one** (precision 67%). It errs toward escalating. That's the safer side for SOS, and it's why SOS recall is the number we watch.
- **It catches only 27% of fake messages.** The rest mostly pass as routine, the lowest priority but one. When it does say "fake", it's always right (precision 100%). That's acceptable only because the model is not the defence against fakes. A forged alert is refused by its signature before triage ever sees it: 0 of 300 accepted, plus 0 breaches in 40,156 attacks in the Directorate gym. A real member sending a false rumour is not something a model can reliably judge. A real alert labelled "fake" still gets delivered, just later.
- **Tuning overfits.** On dev, Llama scored 88% on urgency and 88% on fakes. On test it scored 76% and 27%. That gap is why only test numbers are quoted.
- **English only, and messages written for this world.** It hasn't been tested on other languages or on real crisis messages.
- **The priority isn't protected by the hash, on purpose.** The receiving hub sets it on arrival. It can't change a signed report, only its place in the queue.

## Fairness

Ranking by priority alone can starve a quiet level whose reports keep losing to busier ones. A fair scheduler (`hub/app/scheduler.py`) puts a ceiling on how long any level waits. With Llama's priorities, it cut the longest wait of any level from 998 s to 929 s, and SOS still crossed in 159 s instead of 470 s first-come-first-served (simulated arrivals). It's on in every hub's link (`LINK_FAIR_MAX_WAIT_S`, 60 s by default): SOS always goes first; after that, once a level's oldest message has waited 60 s, it takes the next turn (longest-waiting level first) instead of waiting behind busier levels' higher-priority messages. The deep levels are the ones the Directorate starves.

## Privacy and control

- **Nothing leaves the hub.** The model runs on the laptop; no report goes to a cloud service unless `CLOUD_PROVIDER=gemini` is set for the eval or a mirror.
- **People stay in charge.** The model only orders reports; people read them and decide what to do. Nothing is dispatched automatically. The overview's Try it card shows which path read a message (model, cloud or keyword rules).
- **Turning it off is one setting:** `TRIAGE_ON_INGEST=0`. Reports then keep the order they arrived in. `LINK_FAIR_MAX_WAIT_S=0` turns off the fair scheduler (plain highest priority first).

## Other AI in the repo

- **Message compression** (measured, not in the demo): shrinks a long plea to a 200-byte packet. It checks the facts survived with code plus a DeBERTa entailment model, and sends the full message if the check fails or that model is missing.
- **The Directorate gym's attacker:** the same Llama model plays the Directorate to test the hub. It only ever attacks a throwaway copy.

## Reproduce

```bash
ollama pull llama3.2:3b
hub/.venv/bin/python eval/run_triage_eval.py --split test                              # Llama, the hub default
OLLAMA_MODEL=phi4-mini hub/.venv/bin/python eval/run_triage_eval.py --split test       # Phi-4 mini
hub/.venv/bin/python eval/run_triage_eval.py --split test --backend keywords           # no model
hub/.venv/bin/python eval/make_results_table.py                                        # rebuild RESULTS.md
```
