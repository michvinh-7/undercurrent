## Triage results: dev split, gemini-3.1-flash-lite (51 messages, 10 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 100.0% [100.0, 100.0] |
| Urgency accuracy | 90.2% [82.4, 98.0] |
| sos: precision / recall | 100.0% [100.0, 100.0] / 100.0% [100.0, 100.0] |
| urgent: precision / recall | 80.0% [57.1, 100.0] / 85.7% [64.3, 100.0] |
| routine: precision / recall | 88.9% [72.2, 100.0] / 84.2% [66.7, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 100.0% [100.0, 100.0] |
| Level extracted exactly | 94.1% [86.3, 100.0] |
| People count extracted exactly | 94.1% [86.3, 100.0] |
| Fell back to keyword rules | 9.8% [2.0, 17.6] |
| Seconds per message | 2.758 [1.576, 4.326] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 152.3 [147.1, 158.0] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 18.4 [15.6, 21.8] s |
| SOS delay reduction (link.py, simulated arrivals) | 87.9% [85.6, 89.9] |
| SOS delay, fair scheduler (max wait 60 s) | 18.5 [15.5, 21.9] s |
| Longest wait of any message: first-come / priority / fair | 305.6 [304.7, 306.5] / 357.1 [353.9, 360.0] / 306.1 [305.1, 307.3] s |
