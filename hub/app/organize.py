"""Medical report organizer (Person 2).

Puts a symptom report into one fixed responder format: what was reported, who it
affects, the photo reference and the resident's medical card.

It documents. It never diagnoses: symptoms are copied as reported, nothing is
inferred, named or ranked as a condition.
"""

import re
from typing import Any

DISCLAIMER = "Documentation only. Not a diagnosis."

# Phrases pulled verbatim from free text when the phone didn't send a symptom list.
_SYMPTOM_PHRASES = re.compile(
    r"\b(coughing blood|cough\w*|fever\w*|chills|vomit\w*|nause\w*|diarr?h\w*|rash\w*|"
    r"headache\w*|dizz\w*|shortness of breath|cant breathe|can'?t breathe|chest pain|"
    r"bleeding|burns?|swelling|confus\w*|faint\w*|weak\w*|stomach (?:pain|ache|cramps)|"
    r"sore throat|blurred vision|seizur\w*|unconscious)\b",
    re.I,
)

CARD_FIELDS = ("allergies", "conditions", "medications")


def symptoms_from_text(text: str) -> list[str]:
    """Symptom phrases exactly as written, in order, without duplicates."""
    seen, out = set(), []
    for m in _SYMPTOM_PHRASES.finditer(text or ""):
        phrase = m.group(0).lower()
        if phrase not in seen:
            seen.add(phrase)
            out.append(phrase)
    return out


def _card(card: dict | None) -> dict[str, list[str]]:
    card = card or {}
    return {f: list(card.get(f) or []) for f in CARD_FIELDS}


def organize(payload: dict[str, Any], medical_card: dict | None = None) -> dict[str, Any]:
    """Fixed responder record for a `case` payload (see shared/schemas $defs.case).

    medical_card: overrides payload["medical_card"] when given (the phone fills it).
    """
    raw_text = payload.get("raw_text") or ""
    symptoms = list(payload.get("symptoms") or []) or symptoms_from_text(raw_text)
    return {
        "reported_symptoms": symptoms,
        "symptoms_source": "reported" if payload.get("symptoms") else "extracted_from_text",
        "onset": payload.get("onset"),
        "people_affected": payload.get("people_affected"),
        "photo_id": payload.get("photo_id"),
        "medical_card": _card(medical_card if medical_card is not None else payload.get("medical_card")),
        "raw_text": raw_text,
        "disclaimer": DISCLAIMER,
    }
