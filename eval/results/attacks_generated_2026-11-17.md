## Directorate attacks (2026-11-17, real hub, generated attacks)

| Metric | Value |
|---|---|
| Forged and replayed messages accepted | 0 of 300 (95% upper bound 1.0%) |
| Real member alerts accepted | 40 of 40 |
| "Forgeries blocked" counter | 275 |
| Edited records caught at the exact row | 160 of 160 (95% upper bound on misses 1.9%) |
| Deleted rows put back by the other hub (two hubs) | 20 of 20, chain intact, counter moved by 0, median 0.96 s |

| Attack | Accepted | What the hub said |
|---|---|---|
| forged | 0 of 25 | unknown key (25) |
| impersonated | 0 of 25 | bad signature (25) |
| tampered | 0 of 25 | bad signature (25) |
| replayed | 0 of 25 | replay: duplicate id (25) |
| re-id replay | 0 of 25 | bad signature (25) |
| wrong hub | 0 of 25 | addressed to hub-L12, not this hub (25) |
| stale | 0 of 25 | replay: outside the time window (25) |
| unsigned | 0 of 25 | unsigned (25) |
| roster grab | 0 of 25 | roster: signer is not an operator (25) |
| sync forged | 0 of 25 | deferred (25) |
| sync tampered | 0 of 25 | rejected (25) |
| sync own-hub | 0 of 25 | rejected (25) |

| Edit to the database | Caught at the exact row |
|---|---|
| payload | 20 of 20 |
| level | 20 of 20 |
| author | 20 of 20 |
| created_at | 20 of 20 |
| rehash | 20 of 20 |
| rehash chain | 20 of 20 |
| delete | 20 of 20 |
| delete newest | 20 of 20 |
| priority (known limit, not counted) | 0 of 20 |
| delete newest and record (known limit, not counted) | 0 of 20 |

Known limits: `priority` is the hub's own score and sits outside the hash on purpose, so changing it isn't caught. Deleting the newest row is caught because the hub keeps the hash of every event it wrote; an attacker who also erases that record hides it from a hub on its own. With two hubs the other one still holds the row; it can't be put back then, but the hub's refusal of its own missing event is logged once in GET /rejected.
