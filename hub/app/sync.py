"""Hub-to-hub sync (Person 1).

Merge = union by event id. Two hubs exchange the events the other is missing and
verify the hash chain on arrival. Zero lost or duplicated events is a core claim.

TODO:
- GET /sync/manifest  -> ids (and hashes) this hub holds
- POST /sync/push     -> accept events the sender has and we don't; verify before insert
- pull_from(peer_url) / push_to(peer_url) using httpx
- decide how merged events from other hubs are ordered/chained locally
"""
