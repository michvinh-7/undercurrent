## Triage results: test split, ollama-llama3.2-3b (149 messages, 33 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 62.1% [52.2, 71.4] |
| Urgency accuracy | 75.8% [68.5, 82.6] |
| sos: precision / recall | 67.4% [52.6, 81.0] / 87.9% [75.8, 97.3] |
| urgent: precision / recall | 84.6% [69.2, 96.6] / 57.9% [41.9, 73.3] |
| routine: precision / recall | 75.7% [65.7, 85.1] / 100.0% [100.0, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 27.3% [9.1, 47.4] |
| Level extracted exactly | 95.3% [91.9, 98.7] |
| People count extracted exactly | 93.3% [89.3, 96.6] |
| Fell back to keyword rules | 2.7% [0.7, 5.4] |
| Seconds per message | 1.931 [1.853, 2.016] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 469.8 [455.6, 484.9] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 129.8 [92.6, 171.0] s |
| SOS delay reduction (link.py, simulated arrivals) | 72.4% [63.6, 80.3] |
| SOS delay, fair scheduler (max wait 60 s) | 159.0 [102.5, 225.0] s |
| Longest wait of any message: first-come / priority / fair | 929.2 [928.9, 929.6] / 998.4 [994.8, 1001.9] / 929.0 [928.6, 929.3] s |
