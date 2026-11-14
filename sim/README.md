# sim/ — the simulated Hollow (Person 3)

Generates residents' messages over time from a crisis timeline, plus the hidden ground truth we score against.

Planned files:
- `world.json`: 40 levels, deep levels, hub locations, crisis timeline
- `simulate.py`: messages over time → posts events to a hub
- `ground_truth/`: true case counts per level + the Directorate's falsified figures (never used to tune the AI)
