import json

import httpx
import pytest

from app.triage import Extraction, guard_numbers, keyword_triage, score, triage


def ollama_returning(*responses):
    """A fake Ollama that answers with each response in turn."""
    calls = iter(responses)

    def handler(request):
        body = next(calls)
        if isinstance(body, int):
            return httpx.Response(body)
        return httpx.Response(200, json={"response": body})

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def local_backend(monkeypatch):
    monkeypatch.delenv("CLOUD_PROVIDER", raising=False)


# --- scoring --------------------------------------------------------------------------

def test_urgency_bands_never_overlap():
    worst_sos = Extraction(type="checkin", urgency="sos")
    best_urgent = Extraction(type="case", urgency="urgent", injuries=5, people_count=9, hazard="collapse")
    assert score(worst_sos) > score(best_urgent)


def test_fake_gets_no_bonus():
    fake = Extraction(type="hazard", urgency="fake_suspect", injuries=50, people_count=50, hazard="collapse")
    assert score(fake) == 0.05


# --- number guard ---------------------------------------------------------------------

def test_invented_numbers_are_dropped():
    x = Extraction(type="case", urgency="urgent", level=12, injuries=4, people_count=3)
    out = guard_numbers(x, "three of us sick, someone is hurt")
    assert out.people_count == 3
    assert out.injuries is None
    assert out.level is None


def test_level_hint_fills_missing_level():
    x = Extraction(type="checkin", urgency="routine")
    assert guard_numbers(x, "all fine here", level_hint=31).level == 31


# --- model path -----------------------------------------------------------------------

GOOD = json.dumps({"type": "hazard", "urgency": "sos", "level": 38, "injuries": None,
                   "people_count": 3, "hazard": "flooding"})


def test_model_output_is_scored_by_code():
    rec = triage("sos lvl 38 water rising 3 kids trapped", client=ollama_returning(GOOD))
    assert rec.source == "model"
    assert rec.urgency == "sos" and rec.people_count == 3
    assert rec.priority == 0.95  # .90 + .03 (3 people) + .02 (flooding)


def test_broken_json_retries_once_then_succeeds():
    rec = triage("sos lvl 38 water rising 3 kids trapped", client=ollama_returning("{not json", GOOD))
    assert rec.source == "model"


def test_two_failures_fall_back_to_keywords():
    rec = triage("SOS trapped on level 31", client=ollama_returning("{bad", '{"urgency": "panic"}'))
    assert rec.source == "keywords"
    assert rec.urgency == "sos" and rec.level == 31


def test_ollama_down_falls_back_to_keywords():
    rec = triage("all good on level 4", client=ollama_returning(500, 500))
    assert rec.source == "keywords"


# --- keyword rules --------------------------------------------------------------------

def test_sos_outranks_routine():
    assert keyword_triage("SOS trapped on level 31").priority > keyword_triage("all fine here").priority


def test_keyword_fields():
    rec = keyword_triage("flooding on level 12, 4 people stuck, 2 injured")
    assert (rec.level, rec.people_count, rec.injuries, rec.hazard) == (12, 4, 2, "flooding")


def test_spam_is_flagged():
    assert keyword_triage("FREE RATIONS click here!!!! forward this").urgency == "fake_suspect"


# --- repairing small-model field mix-ups ----------------------------------------------

def test_urgency_word_in_type_key_is_moved_not_discarded():
    x = Extraction.model_validate({"type": "fake_suspect", "urgency": "routine", "level": None,
                                   "injuries": None, "people_count": None, "hazard": None})
    assert (x.urgency, x.type) == ("fake_suspect", "checkin")


def test_swapped_type_and_urgency():
    x = Extraction.model_validate({"type": "sos", "urgency": "hazard"})
    assert (x.type, x.urgency) == ("hazard", "sos")


def test_hazard_kind_in_type_key():
    x = Extraction.model_validate({"type": "flooding", "urgency": "urgent"})
    assert (x.type, x.hazard) == ("hazard", "flooding")


def test_repair_never_invents_an_urgency():
    with pytest.raises(Exception):
        Extraction.model_validate({"type": "checkin", "urgency": "panic"})
