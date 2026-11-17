## Triage results: test split, gemini-3.1-flash-lite (149 messages, 33 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 84.1% [74.4, 91.8] |
| Urgency accuracy | 87.9% [82.6, 92.6] |
| sos: precision / recall | 93.5% [83.3, 100.0] / 87.9% [75.7, 97.3] |
| urgent: precision / recall | 81.0% [68.3, 92.3] / 89.5% [78.6, 97.6] |
| routine: precision / recall | 87.1% [78.0, 94.8] / 96.4% [91.1, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 63.6% [42.3, 83.3] |
| Level extracted exactly | 98.0% [95.3, 100.0] |
| People count extracted exactly | 95.3% [91.9, 98.7] |
| Fell back to keyword rules | 9.4% [4.7, 14.1] |
| Seconds per message | 3.409 [2.546, 4.393] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 560.1 [543.0, 578.0] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 135.1 [85.8, 198.5] s |
| SOS delay reduction (link.py, simulated arrivals) | 75.9% [64.5, 84.7] |
| SOS delay, fair scheduler (max wait 60 s) | 156.6 [93.9, 230.7] s |
| Longest wait of any message: first-come / priority / fair | 1108.2 [1107.9, 1108.6] / 1129.4 [1126.1, 1132.8] / 1108.0 [1107.7, 1108.4] s |
