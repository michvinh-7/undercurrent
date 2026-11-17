## Triage results: test split, keywords (149 messages, 33 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 37.1% [23.5, 52.1] |
| Urgency accuracy | 53.7% [45.6, 61.7] |
| sos: precision / recall | 100.0% [100.0, 100.0] / 27.3% [12.5, 42.9] |
| urgent: precision / recall | 46.4% [28.0, 65.4] / 34.2% [19.4, 50.0] |
| routine: precision / recall | 49.1% [39.4, 58.3] / 92.9% [85.5, 98.4] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 27.3% [9.5, 47.4] |
| Level extracted exactly | 63.1% [55.0, 70.5] |
| People count extracted exactly | 92.6% [87.9, 96.6] |
| Fell back to keyword rules | 100.0% [100.0, 100.0] |
| Seconds per message | 0.000 [0.000, 0.000] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 470.6 [456.3, 485.7] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 330.3 [235.6, 423.8] s |
| SOS delay reduction (link.py, simulated arrivals) | 29.8% [10.1, 49.9] |
| SOS delay, fair scheduler (max wait 60 s) | 366.2 [287.6, 437.0] s |
| Longest wait of any message: first-come / priority / fair | 930.8 [930.5, 931.1] / 997.0 [992.5, 1001.3] / 930.7 [930.4, 931.1] s |
