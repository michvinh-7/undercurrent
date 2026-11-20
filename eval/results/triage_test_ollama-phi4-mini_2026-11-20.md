## Triage results: test split, ollama-phi4-mini (149 messages, 33 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 55.1% [45.7, 64.3] |
| Urgency accuracy | 77.2% [69.8, 83.9] |
| sos: precision / recall | 65.2% [51.0, 78.7] / 90.9% [79.4, 100.0] |
| urgent: precision / recall | 77.1% [61.8, 90.3] / 71.1% [55.9, 85.0] |
| routine: precision / recall | 84.8% [75.8, 93.0] / 100.0% [100.0, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 9.1% [0.0, 23.5] |
| Level extracted exactly | 91.9% [87.2, 96.0] |
| People count extracted exactly | 91.3% [86.6, 95.3] |
| Fell back to keyword rules | 6.0% [2.7, 10.1] |
| Seconds per message | 2.424 [2.311, 2.555] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 560.0 [543.0, 577.9] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 200.7 [134.5, 280.1] s |
| SOS delay reduction (link.py, simulated arrivals) | 64.2% [50.3, 75.8] |
| SOS delay, fair scheduler (max wait 60 s) | 198.8 [135.0, 270.9] s |
| Longest wait of any message: first-come / priority / fair | 1108.1 [1107.8, 1108.5] / 1185.6 [1178.6, 1192.2] / 1108.2 [1107.8, 1108.6] s |
