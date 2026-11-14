"""Event models. Mirrors shared/schemas/event.schema.json; change both together."""

from typing import Any, Literal

from pydantic import BaseModel, Field

EventType = Literal["checkin", "hazard", "case", "missing_person"]


class EventIn(BaseModel):
    """What a client sends. The hub fills in the rest."""

    type: EventType
    level: int = Field(ge=1, le=40)
    author: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: float | None = Field(default=None, ge=0, le=1)


class Event(EventIn):
    """A stored event, exactly as it sits in the log."""

    id: str
    hub_id: str
    created_at: str
    prev_hash: str
    hash: str
