"""Event models. Mirrors shared/schemas/event.schema.json; change both together.

Signed events: the signer (phone, Canary box, sim) sets id, created_at and hub_id
itself, then signs the fields in SIGNED_FIELDS (see crypto.canonical_bytes). The hub
checks the signature instead of minting those fields. Unsigned events (no sig) still
work while REQUIRE_SIGNED=0: the hub fills id, created_at and hub_id as before.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

EventType = Literal["checkin", "hazard", "case", "missing_person", "roster", "exchange"]
Source = Literal["resident", "sensor"]

# What a signature covers, and (plus sig) what the chain hash covers. Fields that are
# null or missing are left out, so events from before signing hash exactly as they did.
# priority is deliberately outside: the hub scores it on arrival and may rescore it.
SIGNED_FIELDS = (
    "id", "type", "hub_id", "level", "created_at", "author", "payload",
    "author_pub", "source", "device_id",
)


class EventIn(BaseModel):
    """What a client sends. Unsigned: type, level, author, payload. Signed: SIGNED_FIELDS + sig."""

    type: EventType
    level: int = Field(ge=1, le=40)
    author: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: float | None = Field(default=None, ge=0, le=1)
    # Set by the signer. The hub mints id/created_at/hub_id only for unsigned events.
    id: str | None = Field(default=None, min_length=1, max_length=64)
    created_at: str | None = None
    hub_id: str | None = None
    author_pub: str | None = Field(default=None, description="Ed25519 public key, base64")
    sig: str | None = Field(default=None, description="Ed25519 signature over crypto.canonical_bytes, base64")
    source: Source | None = Field(default=None, description="null means resident")
    device_id: str | None = Field(default=None, max_length=64, description="Canary box id, sensor events only")


class Event(EventIn):
    """A stored event, exactly as it sits in the log."""

    id: str
    hub_id: str
    created_at: str
    prev_hash: str
    hash: str
