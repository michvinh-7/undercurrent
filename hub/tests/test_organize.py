import json
import re
from pathlib import Path

from app.organize import DISCLAIMER, organize

EXAMPLE = Path(__file__).resolve().parents[2] / "shared" / "schemas" / "examples" / "case.json"

DIAGNOSIS_WORDS = re.compile(
    r"\b(diagnos\w*|you have|likely|probably|suspected|cholera|tuberculosis|pneumonia|"
    r"typhoid|infection|disease|condition is)\b", re.I)

CARD = {"allergies": ["penicillin"], "conditions": ["asthma"], "medications": ["salbutamol"]}


def test_example_case_is_documented_not_diagnosed():
    payload = json.loads(EXAMPLE.read_text())["payload"]
    out = organize(payload, CARD)
    assert out["reported_symptoms"] == payload["symptoms"]
    assert out["disclaimer"] == DISCLAIMER
    generated = {k: v for k, v in out.items() if k not in ("raw_text", "medical_card", "disclaimer")}
    assert not DIAGNOSIS_WORDS.search(json.dumps(generated))


def test_medical_card_passes_through_unchanged():
    assert organize({"symptoms": ["fever"]}, CARD)["medical_card"] == CARD


def test_symptoms_extracted_verbatim_from_text():
    out = organize({"raw_text": "kid has a Fever and keeps vomiting, fever since last night"})
    assert out["reported_symptoms"] == ["fever", "vomiting"]
    assert out["symptoms_source"] == "extracted_from_text"


def test_missing_card_fields_are_empty_lists():
    assert organize({"symptoms": []})["medical_card"] == {"allergies": [], "conditions": [], "medications": []}
