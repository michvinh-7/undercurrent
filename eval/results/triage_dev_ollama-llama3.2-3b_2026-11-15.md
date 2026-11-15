## Triage results: dev split, ollama-llama3.2-3b (51 messages, 10 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 35.6% [23.6, 47.5] |
| Urgency accuracy | 58.8% [45.1, 72.5] |
| sos: precision / recall | 47.1% [23.1, 71.4] / 80.0% [50.0, 100.0] |
| urgent: precision / recall | 60.0% [0.0, 100.0] / 21.4% [0.0, 46.2] |
| routine: precision / recall | 65.5% [47.8, 82.4] / 100.0% [100.0, 100.0] |
| fake_suspect: precision / recall | nan% [nan, nan] / 0.0% [0.0, 0.0] |
| Level extracted exactly | 94.1% [86.3, 100.0] |
| People count extracted exactly | 90.2% [82.4, 98.0] |
| Fell back to keyword rules | 15.7% [5.9, 25.5] |
| Seconds per message | 1.606 [1.467, 1.759] |
| SOS delay, first-come-first-served (simulated link, 50 B/s) | 8.2 [7.9, 8.5] s |
| SOS delay, priority queue (simulated link) | 4.2 [3.9, 4.7] s |
| SOS delay reduction (simulated link) | 48.2% [41.2, 54.2] |
