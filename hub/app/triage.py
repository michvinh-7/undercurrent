"""AI triage (Person 2).

Messy text in, structured record + priority out.

Split of work, so the AI never does math or invents a number:
- The model (local Ollama, or Gemini on the online mirror) only *extracts* fields
  and picks an urgency class.
- Code checks every number the model returns against the message text, and
  `score()` turns the fields into the 0-1 priority with a fixed formula.

If the model's JSON is broken or invalid: retry once, then fall back to keyword
rules. Broken data never reaches the screen.
"""

import json
import os
import re
from typing import Literal

import httpx
from pydantic import BaseModel, Field, ValidationError, field_validator

Urgency = Literal["sos", "urgent", "routine", "fake_suspect"]
HazardKind = Literal["flooding", "bad_air", "bad_water", "heat", "blackout", "collapse", "other"]
EventType = Literal["checkin", "hazard", "case", "missing_person"]


class Extraction(BaseModel):
    """What the model is allowed to return. Anything else fails validation."""

    type: EventType
    urgency: Urgency
    level: int | None = Field(default=None, ge=1, le=40)
    injuries: int | None = Field(default=None, ge=0)
    people_count: int | None = Field(default=None, ge=0)
    hazard: HazardKind | None = None

    @field_validator("hazard", mode="before")
    @classmethod
    def _blank_hazard(cls, v):
        return None if v in ("", "none", "null") else v


class TriageRecord(Extraction):
    priority: float = Field(ge=0, le=1)
    source: Literal["model", "cloud", "keywords"]


# --------------------------------------------------------------------------- scoring

# Urgency sets the band; details nudge within it. Bonuses total at most 0.09,
# so a class never overtakes the one above it (sos >= 0.90 > urgent <= 0.74).
URGENCY_BASE = {"sos": 0.90, "urgent": 0.65, "routine": 0.25, "fake_suspect": 0.05}
SEVERE_HAZARDS = {"flooding", "collapse", "bad_air"}


def score(x: Extraction) -> float:
    """Priority 0-1 from extracted fields. Plain arithmetic, done here, never by the model.

    base by urgency (sos .90, urgent .65, routine .25, fake_suspect .05)
    + .04 if anyone is injured
    + .03 if 3 or more people are involved
    + .02 if the hazard is flooding, collapse or bad air
    Fake-suspect messages get no bonuses.
    """
    p = URGENCY_BASE[x.urgency]
    if x.urgency != "fake_suspect":
        if x.injuries:
            p += 0.04
        if x.people_count and x.people_count >= 3:
            p += 0.03
        if x.hazard in SEVERE_HAZARDS:
            p += 0.02
    return round(min(p, 1.0), 2)


# --------------------------------------------------------------------------- numbers

_NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "dozen": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "both": 2, "couple": 2, "pair": 2,
}


def numbers_in(text: str) -> set[int]:
    """Every integer the message actually states, as digits or common words."""
    found = {int(n) for n in re.findall(r"\d+", text)}
    found |= {_NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", text.lower()) if w in _NUMBER_WORDS}
    return found


def guard_numbers(x: Extraction, text: str, level_hint: int | None = None) -> Extraction:
    """Drop any count the model returned that the message never stated."""
    stated = numbers_in(text)
    updates = {f: None for f in ("injuries", "people_count") if getattr(x, f) not in (None, *stated)}
    level = x.level
    if level is not None and level not in stated and level != level_hint:
        level = None
    updates["level"] = level if level is not None else level_hint
    return x.model_copy(update=updates)


# --------------------------------------------------------------------------- keyword fallback

_SOS = re.compile(
    r"\b(sos|mayday|trapped|dying|not breathing|cant breathe|can'?t breathe|unconscious|"
    r"bleeding (bad|a lot|out)|crushed|drowning|pinned|help us now|please hurry)\b", re.I)
_URGENT = re.compile(
    r"\b(hurt|injur\w*|bleed\w*|broken|fever\w*|vomit\w*|cough\w*|rash|sick|"
    r"flood\w*|collapse\w*|smoke|gas|fumes|no water|contaminat\w*|missing|need help|"
    r"need_help|running out|no air)\b", re.I)
_FAKE = re.compile(
    r"(click here|free (rations|credits|water)|forward this|share before|"
    r"directorate says all clear|everyone on every level|whole hollow is|!!!!|http)", re.I)

_HAZARDS: list[tuple[HazardKind, re.Pattern]] = [
    ("collapse", re.compile(r"\b(collaps\w*|cave[- ]?in|ceiling (came|fell)|rubble|crushed)\b", re.I)),
    ("flooding", re.compile(r"\b(flood\w*|water (is )?rising|knee deep|waist deep)\b", re.I)),
    ("bad_air", re.compile(r"\b(smoke|gas|fumes|no air|cant breathe|can'?t breathe|air (is )?bad)\b", re.I)),
    ("bad_water", re.compile(r"\b(brown water|water (tastes|smells)|contaminat\w*|bad water|dirty water)\b", re.I)),
    ("heat", re.compile(r"\b(heat|too hot|overheat\w*)\b", re.I)),
    ("blackout", re.compile(r"\b(blackout|no power|lights? (are )?out|power('?s)? (out|down))\b", re.I)),
]
_SYMPTOMS = re.compile(r"\b(fever\w*|cough\w*|vomit\w*|rash|diarr?h\w*|sick|dizzy|chills|headache)\b", re.I)
_MISSING = re.compile(r"\b(missing|haven'?t seen|havent seen|lost track|last seen|can'?t find|cant find)\b", re.I)

_NUM = r"\b(\d+|" + "|".join(sorted(_NUMBER_WORDS, key=len, reverse=True)) + r")"
_PEOPLE = re.compile(_NUM + r"\s+(?:\w+\s+)?(people|ppl|of us|kids|children|adults|families|persons|workers|residents|men|women)\b", re.I)
_INJURED = re.compile(_NUM + r"\s+(?:\w+\s+)?(injured|hurt|wounded|bleeding)\b", re.I)
_LEVEL = re.compile(r"\b(?:level|lvl|lv|l)\s*-?\s*(\d{1,2})\b", re.I)


def _to_int(token: str) -> int:
    return int(token) if token.isdigit() else _NUMBER_WORDS[token.lower()]


def keyword_extract(text: str, level_hint: int | None = None) -> Extraction:
    if _FAKE.search(text):
        urgency = "fake_suspect"
    elif _SOS.search(text):
        urgency = "sos"
    elif _URGENT.search(text):
        urgency = "urgent"
    else:
        urgency = "routine"

    hazard = next((kind for kind, rx in _HAZARDS if rx.search(text)), None)
    if _MISSING.search(text):
        type_ = "missing_person"
    elif _SYMPTOMS.search(text):
        type_ = "case"
    elif hazard:
        type_ = "hazard"
    else:
        type_ = "checkin"

    level = _LEVEL.search(text)
    level_val = int(level.group(1)) if level and 1 <= int(level.group(1)) <= 40 else level_hint
    people = _PEOPLE.search(text)
    injured = _INJURED.search(text)
    return Extraction(
        type=type_,
        urgency=urgency,
        level=level_val,
        injuries=_to_int(injured.group(1)) if injured else None,
        people_count=_to_int(people.group(1)) if people else None,
        hazard=hazard,
    )


def keyword_triage(text: str, level_hint: int | None = None) -> TriageRecord:
    """Fallback when the model is slow, missing or its output is unusable."""
    x = keyword_extract(text, level_hint)
    return TriageRecord(**x.model_dump(), priority=score(x), source="keywords")


# --------------------------------------------------------------------------- model backends

PROMPT = """You sort emergency messages from the Hollow, an underground city with 40 levels.
Return ONLY a JSON object with exactly these keys:
  "type": one of "checkin", "hazard", "case", "missing_person"
  "urgency": one of
      "sos"          life in danger right now (trapped, not breathing, heavy bleeding, drowning)
      "urgent"       needs help soon (injuries, illness, hazard spreading, missing person)
      "routine"      status update, nobody in immediate danger
      "fake_suspect" spam, rumor, propaganda, or claims that can't be from one person
  "level": the level number if the message states it, else null
  "injuries": number of injured people if the message states it, else null
  "people_count": number of people involved if the message states it, else null
  "hazard": one of "flooding","bad_air","bad_water","heat","blackout","collapse","other", or null
Never guess a number. If the message does not say it, use null. No priority, no explanation.

Message: {text}"""

TIMEOUT_S = 30


def _ask_ollama(text: str, client: httpx.Client) -> str:
    url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
    r = client.post(
        f"{url}/api/generate",
        json={"model": model, "prompt": PROMPT.format(text=text), "format": "json", "stream": False,
              "options": {"temperature": 0}},
        timeout=TIMEOUT_S,
    )
    r.raise_for_status()
    return r.json()["response"]


def _ask_gemini(text: str, client: httpx.Client) -> str:
    model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
    r = client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
        json={
            "contents": [{"parts": [{"text": PROMPT.format(text=text)}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        },
        timeout=TIMEOUT_S,
    )
    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def backend() -> Literal["model", "cloud"]:
    """Cloud only when explicitly configured (the online mirror). Hubs stay local."""
    return "cloud" if os.getenv("CLOUD_PROVIDER", "").lower() == "gemini" else "model"


def triage(text: str, level_hint: int | None = None, client: httpx.Client | None = None) -> TriageRecord:
    """Structured record + priority for one message. Never raises on model trouble.

    level_hint: the level of the hub/phone the message came from, used when the
    message itself doesn't say.
    """
    source = backend()
    ask = _ask_gemini if source == "cloud" else _ask_ollama
    own_client = client is None
    client = client or httpx.Client()
    try:
        for _ in range(2):  # first try + one retry
            try:
                x = Extraction.model_validate(json.loads(ask(text, client)))
            except (httpx.HTTPError, ValueError, ValidationError, KeyError, IndexError, TypeError):
                continue
            x = guard_numbers(x, text, level_hint)
            return TriageRecord(**x.model_dump(), priority=score(x), source=source)
    finally:
        if own_client:
            client.close()
    return keyword_triage(text, level_hint)
