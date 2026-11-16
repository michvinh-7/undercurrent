## Triage results: dev split, ollama-llama3.2-3b (51 messages, 10 SOS)

| Metric | Value [95% CI] |
|---|---|
| SOS ranked first in a batch of 10 | 76.4% [66.4, 86.9] |
| Urgency accuracy | 60.8% [47.1, 74.5] |
| sos: precision / recall | 80.0% [50.0, 100.0] / 80.0% [50.0, 100.0] |
| urgent: precision / recall | 33.3% [0.0, 100.0] / 7.1% [0.0, 25.0] |
| routine: precision / recall | 54.3% [37.5, 71.0] / 100.0% [100.0, 100.0] |
| fake_suspect: precision / recall | 100.0% [100.0, 100.0] / 37.5% [0.0, 75.0] |
| Level extracted exactly | 84.3% [74.5, 94.1] |
| People count extracted exactly | 92.2% [84.3, 98.0] |
| Fell back to keyword rules | 3.9% [0.0, 9.8] |
| Seconds per message | 1.775 [1.623, 1.945] |
| SOS delay, first-come-first-served (link.py at 50 B/s, simulated arrivals) | 122.2 [118.1, 126.8] s |
| SOS delay, priority queue (link.py, simulated arrivals) | 17.1 [13.7, 21.2] s |
| SOS delay reduction (link.py, simulated arrivals) | 86.0% [82.6, 88.8] |
