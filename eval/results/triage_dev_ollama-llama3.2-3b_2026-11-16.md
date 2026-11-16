## Triage results: dev split, ollama-llama3.2-3b (51 messages, 10 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 78.3% [68.8, 88.1] |
| Urgency accuracy | 88.2% [78.4, 96.1] |
| sos: precision / recall | 76.9% [50.0, 100.0] / 100.0% [100.0, 100.0] |
| urgent: precision / recall | 100.0% [100.0, 100.0] / 64.3% [37.5, 88.9] |
| routine: precision / recall | 86.4% [70.0, 100.0] / 100.0% [100.0, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 87.5% [60.0, 100.0] |
| Level extracted exactly | 94.1% [86.3, 100.0] |
| People count extracted exactly | 94.1% [86.3, 100.0] |
| Fell back to keyword rules | 0.0% [0.0, 0.0] |
| Seconds per message | 1.550 [1.506, 1.602] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 122.3 [118.2, 126.9] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 16.4 [13.6, 19.3] s |
| SOS delay reduction (link.py, simulated arrivals) | 86.6% [84.1, 89.0] |
| SOS delay, fair scheduler (max wait 60 s) | 16.4 [13.7, 19.3] s |
| Longest wait of any message: first-come / priority / fair | 244.6 [243.7, 245.5] / 306.4 [302.6, 310.0] / 245.6 [244.4, 246.9] s |
