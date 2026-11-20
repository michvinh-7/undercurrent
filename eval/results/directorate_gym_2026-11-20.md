## Directorate gym (2026-11-20): adaptive attackers, one isolated episode each

Golden hub: 13 signed events, a roster of 5, 3 intercepted alerts. Every episode runs on its own copy and is thrown away.

| Metric | Fuzzer | LLM attacker (llama3.2:3b) |
|---|---|---|
| Episodes | 2000 | 20 |
| Attempts | 40000 | 156 |
| Episodes with a breach | 0 | 0 |
| 95% upper bound on episodes breached (%) | 0.15 | 13.911 |
| Episodes that edited or deleted rows | 1988 | 16 |
| …flagged by the hub's chain check | 1975 | 15 |
| …flagged by verify.py | 1975 | 15 |
| …unseen by the hub alone (known limit) | 13 | 1 |
| …of those, put back by one sync round | 13 | 1 |
| Real intercepted alerts delivered (not a breach) | 72 | 0 |
| Attacks that made the hub raise an error | 0 | 0 |
| Reset, median ms | 0.93 | 3.37 |
| Reset, 95th percentile ms | 7.4 | 4.52 |
| Resets identical to the golden hub | 2000 | 20 |

Fuzzer: 20 attempts per episode on 6 processes, 1047 attempts/s; 50 of 50 episodes replayed from their seed ended in the identical state. Golden database unchanged after every episode: True.
LLM attacker: 8 moves per episode, seeing each refusal reason; 35 moves were malformed or invalid.

Outcomes by action (fuzzer). Per-attempt "edited, NOT flagged" lines are edits that set a field to the value it already had, or deletions of the other hub's rows (put back by sync); the episode rows above are the score.

- `db_delete`: 4714 edited, flagged, 291 edited, NOT flagged
- `db_edit`: 4726 edited, flagged, 203 invalid, 153 edited, NOT flagged
- `forge`: 3756 refused, 1132 malformed, 18 not stored
- `reuse`: 7569 refused, 2297 malformed, 70 accepted
- `roster_grab`: 5021 refused
- `splice`: 3806 refused, 1164 malformed, 2 accepted
- `unsigned`: 3830 refused, 1248 malformed
