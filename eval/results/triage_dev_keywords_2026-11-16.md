## Triage results: dev split, keywords (51 messages, 10 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 59.4% [32.9, 86.2] |
| Urgency accuracy | 54.9% [41.2, 68.6] |
| sos: precision / recall | 100.0% [100.0, 100.0] / 30.0% [0.0, 62.5] |
| urgent: precision / recall | 44.4% [11.1, 80.0] / 28.6% [6.7, 53.8] |
| routine: precision / recall | 50.0% [33.3, 66.7] / 94.7% [82.4, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 37.5% [0.0, 75.0] |
| Level extracted exactly | 68.6% [54.9, 80.4] |
| People count extracted exactly | 92.2% [84.3, 98.0] |
| Fell back to keyword rules | 100.0% [100.0, 100.0] |
| Seconds per message | 0.000 [0.000, 0.000] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 122.5 [118.3, 127.1] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 55.7 [18.8, 95.9] s |
| SOS delay reduction (link.py, simulated arrivals) | 54.5% [19.9, 85.1] |
| SOS delay, fair scheduler (max wait 60 s) | 83.7 [51.4, 113.7] s |
| Longest wait of any message: first-come / priority / fair | 244.9 [244.1, 245.9] / 319.0 [313.2, 324.9] / 245.1 [244.1, 246.0] s |
