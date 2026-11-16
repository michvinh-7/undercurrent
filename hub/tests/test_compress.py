"""Compression tests use a fake NLI scorer: fast, and nothing is downloaded."""

import re

from app.compress import (
    BUDGET_BYTES, NLIUnavailable, compress, facts_of, squeeze, verify,
)
from app.triage import Extraction


class KeywordNLI:
    """Stand-in for the NLI model: a hypothesis counts as entailed only if the
    premise states it in context (same rule as the real check is meant to enforce)."""

    def entailment(self, premise, hypotheses):
        p = premise.lower()
        out = []
        for h in hypotheses:
            n = re.search(r"\d+", h)
            if "level" in h:
                ok = re.search(rf"level {n.group()}\b", p)
            elif "injured" in h or "hurt" in h:
                ok = re.search(rf"\b{n.group()}\b(\s+\w+){{0,10}}\s+(hurt|injur|bleed)", p)
            elif "affected" in h or "There are" in h or "trapped" in h:
                ok = re.search(rf"\b{n.group()}\s+(\w+\s+)?(kids|people|of us|children)", p)
            elif "flooding" in h or "Water is rising" in h:
                ok = re.search(r"flood|water", p)
            else:
                ok = None
            out.append(1.0 if ok else 0.0)
        return out


class DownNLI:
    def entailment(self, premise, hypotheses):
        raise NLIUnavailable("not downloaded")


LONG = (
    "Hello, I don't really know if anyone is reading this but please, we really need help. "
    "My name is Ana and I live with my family in the east block. It has been a very long night. "
    "The pumps stopped working about two hours ago, maybe a bit more, and nobody came to fix them. "
    "Now the water is rising on level 38 and it is already up to our knees in the corridor. "
    "Three kids are trapped in the pump room because the door jammed when the power went out. "
    "Two of the adults who tried to open it are hurt, one cut his hand badly on the metal. "
    "We have tried calling the Directorate line many times but it just rings and rings. "
    "Our neighbours on the next corridor say the same thing is happening there too. "
    "Please send anyone who can open a jammed door and anyone with medical supplies. "
    "We are scared and the water keeps coming. Thank you, thank you, please hurry."
)
RECORD = Extraction(type="hazard", urgency="sos", level=38, people_count=3, injuries=2, hazard="flooding")


def test_facts_come_from_the_record():
    names = [f.name for f in facts_of(RECORD)]
    assert names == ["level", "people_count", "injuries", "hazard"]


def test_short_message_is_sent_as_is():
    p = compress("sos level 12 flooding, 4 of us", Extraction(type="hazard", urgency="sos", level=12,
                 people_count=4, hazard="flooding"), scorer=KeywordNLI(), use_model=False)
    assert (p.method, p.full) == ("original", False)


def test_long_plea_squeezes_into_one_packet_with_every_fact():
    assert len(LONG.encode()) > 3 * BUDGET_BYTES
    p = compress(LONG, RECORD, scorer=KeywordNLI(), use_model=False)
    assert not p.full and p.method == "squeeze"
    assert p.bytes <= BUDGET_BYTES
    assert verify(facts_of(RECORD), p.text, KeywordNLI()).passed


def test_unrelated_number_doesnt_count_as_the_fact():
    # "2 hours ago" must not be taken as "2 people injured"
    from app.compress import Fact, _carries
    injured = Fact("injuries", 2, ["2 people are injured."])
    assert not _carries("pumps stopped 2 hours ago", injured)
    assert _carries("2 of the adults who tried to open it are hurt", injured)


def test_squeeze_turns_number_words_into_digits_and_keeps_negations():
    out = squeeze("Three people trapped. He is not breathing.", 200)
    assert "3" in out and "not breathing" in out


def test_packet_missing_a_fact_is_never_shipped():
    # A message whose only copy of the injury count sits in a sentence that can't fit.
    text = ("Level 9 flooding. " + "We waited and waited for the pumps to come back on but nothing happened at all. " * 5
            + "Somewhere far down in this very long message we mention that 7 people are injured badly.")
    record = Extraction(type="hazard", urgency="urgent", level=9, injuries=7, hazard="flooding")
    p = compress(text, record, budget=60, scorer=KeywordNLI(), use_model=False)
    assert p.full and p.text is None
    assert any("injuries" in missing for _, missing in p.tried)


def test_nli_unavailable_fails_closed_to_full_message():
    p = compress(LONG, RECORD, scorer=DownNLI(), use_model=False)
    assert p.full and "not downloaded" in p.reason


def test_no_facts_means_nothing_to_lose():
    assert verify([], "anything", DownNLI()).passed


def test_facts_the_model_missed_are_still_protected():
    from app.compress import with_keyword_facts
    model_missed_level = Extraction(type="hazard", urgency="urgent", hazard="flooding")
    filled = with_keyword_facts(model_missed_level, "water rising on level 29, 9 of us here")
    assert (filled.level, filled.people_count) == (29, 9)
    # never overrides what the model did find
    assert with_keyword_facts(RECORD, "level 12").level == 38
