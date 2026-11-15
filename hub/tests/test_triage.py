from app.triage import keyword_triage


def test_sos_outranks_routine():
    assert keyword_triage("SOS trapped on level 31")["priority"] > keyword_triage("all fine here")["priority"]


def test_level_extracted():
    assert keyword_triage("flooding on level 12")["level"] == 12
