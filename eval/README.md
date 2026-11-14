# eval/ — proving it works (Person 2)

Planned files:
- `messages_labeled.jsonl`: ~200 hand-labeled test messages (SOS, urgent, routine, fake). Never tune on these.
- `run_triage_eval.py`: SOS-ranked-first %, time-to-deliver vs first-come-first-served
- `run_compression_eval.py`: critical facts kept after compression (NLI check)
- `results/`: every reported number with a bootstrapped 95% CI
