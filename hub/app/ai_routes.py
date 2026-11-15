"""AI endpoints (Person 2). Mounted by main.py with:

    from .ai_routes import router as ai_router
    app.include_router(ai_router)
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .organize import organize
from .triage import TriageRecord, triage

router = APIRouter(tags=["ai"])


class TriageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    level: int | None = Field(default=None, ge=1, le=40, description="Level of the sending hub/phone, if known")


class OrganizeIn(BaseModel):
    payload: dict[str, Any]
    medical_card: dict[str, Any] | None = None


@router.post("/triage", response_model=TriageRecord)
def triage_message(body: TriageIn):
    return triage(body.text, level_hint=body.level)


@router.post("/organize")
def organize_case(body: OrganizeIn):
    return organize(body.payload, body.medical_card)
