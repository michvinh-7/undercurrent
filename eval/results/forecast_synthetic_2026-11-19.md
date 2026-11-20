## Blackout forecast, synthetic voltage sags (2026-11-19, n=1000 sags + 1000 steady supplies)

| Metric | Forecast (line fit, last 8 readings) | Baseline (last 2 readings) |
|---|---|---|
| Error in predicted drop-out time, 60 min before it (median, min) | 6.3 [4.9, 7.6] | 26.7 [23.8, 32.1] |
| Error in predicted drop-out time, 30 min before it (median, min) | 2.6 [2.2, 2.9] | 7.4 [6.5, 8.5] |
| Error in predicted drop-out time, 15 min before it (median, min) | 1.1 [1.0, 1.2] | 2.3 [2.1, 2.5] |
| Sags warned before they drop out | 99.6% [99.2, 99.9] | – |
| How far ahead the first warning comes (median, min) | 14.0 [12.4, 15.5] | – |
| Sags warned at least 15 min ahead (the fastest drop out in ~15 min, before 4 readings exist) | 47.6% [44.5, 50.6] | – |
| True time inside the forecast's range, 30 min out | 73.0% [68.0, 77.7] | – |
| False alarms on steady supplies (within the hour) | 0.0% [0.0, 0.0] | 35.3% [32.3, 38.2] |
| Setup | readings every 5 min, cutoff 180 V, synthetic, seed 7 | |
