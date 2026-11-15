# eval/: proving it works (Person 2)

| File | What it is |
|---|---|
| `messages_labeled.jsonl` | 200 labeled messages: 40 SOS, 55 urgent, 75 routine, 30 fake. 51 `dev`, 149 `test` (split stratified by label, seed 2087) |
| `review_labels.py` | Page through the set and accept or fix labels (`reviewed: true` once checked) |
| `run_triage_eval.py` | Runs triage on a split and writes a results table with 95% CIs to `results/` |
| `stats.py` | `bootstrap_ci()`: percentile bootstrap, pure Python |

## Rules

- **Tune on `dev` only.** Prompt changes, keyword rules and score weights get checked against `dev`. `test` is run to report numbers, never to decide changes. The script writes per-message misses only for `dev`.
- **Separate from the sim.** This set stays apart from Alanna's simulated ground truth; neither is used to tune the other.
- **Rerun before the video.** If a number looks too good, rerun it on held-out messages before it goes in the video (contract).
- **Label the link.** Time-to-deliver comes from a *simulated link* until `hub/app/link.py` is wired in, and is labeled that way wherever it's shown.

## Labeling conventions

- **`label`**
  - `sos`: life in danger right now.
  - `urgent`: needs help soon.
  - `routine`: status only.
  - `fake`: spam, rumor, propaganda or impossible claims.
- **`level`, `people_count`, `injuries`:** only when the message states them. Otherwise `null`.
- **`hazard`:** one of the schema's hazard kinds, or `null`.

## Known caveat

The draft messages were written by Claude, who also wrote the keyword fallback rules. Keyword-backend numbers on this set may be optimistic. For the video, prefer:
- model-backend numbers, and
- a second held-out set written by someone else (Alanna's sim messages, or Taheful's labeling slice).

## Run

```bash
hub/.venv/bin/python eval/review_labels.py
hub/.venv/bin/python eval/run_triage_eval.py --split dev --backend keywords   # no model needed
hub/.venv/bin/python eval/run_triage_eval.py --split dev                      # Ollama, keyword fallback
hub/.venv/bin/python eval/run_triage_eval.py --split test                     # report only
```
