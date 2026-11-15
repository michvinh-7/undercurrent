"""Link simulation (Person 1).

Adjustable bandwidth between hubs (bytes per second). The outbound queue sends
highest priority first (see scheduler.py for the fairness rule).
Person 4's bandwidth slider and "cut the network" button call into this.

TODO:
- set_bandwidth(bps), cut(), restore()
- send queue drained at the configured rate
"""
