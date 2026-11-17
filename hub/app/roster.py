"""Who may post: the cell's members and the operators who add them.

Starts from ROSTER_FILE (a JSON list of {"pub": "<base64>", "role": "operator"|"member",
"name": optional}), which is how the demo preloads keys. After that, membership changes
only through roster events in the log, signed by an operator:

    {"type": "roster", "level": 12, "author": "op-1",
     "payload": {"action": "add" | "remove", "pub": "<base64>", "role": "member" | "operator"}}

Roster events sync like any other event, so every hub ends up with the same roster.
"""

import json
import os
from pathlib import Path

ROLES = ("member", "operator")


class Roster:
    def __init__(self, entries: list[dict] | None = None):
        self._roles: dict[str, str] = {}
        for entry in entries or []:
            self._roles[entry["pub"]] = entry.get("role", "member")

    @classmethod
    def from_env(cls) -> "Roster":
        path = os.getenv("ROSTER_FILE")
        return cls(json.loads(Path(path).read_text())) if path else cls()

    def is_member(self, pub: str | None) -> bool:
        return pub in self._roles

    def is_operator(self, pub: str | None) -> bool:
        return self._roles.get(pub) == "operator"

    def invalid(self, payload: dict) -> str | None:
        """Why a roster event's payload is malformed, or None."""
        if payload.get("action") not in ("add", "remove"):
            return "roster: action must be add or remove"
        if not isinstance(payload.get("pub"), str) or not payload["pub"]:
            return "roster: pub missing"
        if payload["action"] == "add" and payload.get("role", "member") not in ROLES:
            return f"roster: role must be one of {', '.join(ROLES)}"
        return None

    def apply(self, payload: dict) -> None:
        if payload["action"] == "add":
            self._roles[payload["pub"]] = payload.get("role", "member")
        else:
            self._roles.pop(payload["pub"], None)

    def snapshot(self) -> list[dict]:
        return [{"pub": pub, "role": role} for pub, role in sorted(self._roles.items())]
