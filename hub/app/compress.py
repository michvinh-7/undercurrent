"""Compression + fact check (Person 2, Upgrade 2).

Shrinks a message to fit a 200-byte packet for slow links, then proves the
critical facts survived before anything is sent.

    packet = compress(text, record)   # record = triage(text), facts come from the ORIGINAL
    packet.full                       # True -> send the full message instead

Candidates are tried in order; the first one that fits AND passes the fact check wins:
    1. the original, if it already fits
    2. a rule-based squeeze (number words -> digits, filler dropped, fact-bearing
       sentences kept first, cut at a word boundary)
    3. a model rewrite (same Ollama/Gemini backend as triage), up to 2 tries
If none passes, the full message is sent. A packet that failed the check is never shipped.

The fact check (verify) needs every fact the original stated to survive:
    - code check: every stated number (level, people, injuries) appears in the packet
    - NLI check: a DeBERTa NLI model rates "This is on level 38." etc. as entailed by
      the packet with probability >= ENTAIL_THRESHOLD
If the NLI model can't load (not downloaded, offline), verify fails closed: full message.
Download it once with: hub/.venv/bin/python hub/scripts/download_nli.py
"""

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Literal, Protocol

import httpx

from .triage import Extraction, backend, keyword_extract, numbers_in

BUDGET_BYTES = 200
ENTAIL_THRESHOLD = 0.7
DEFAULT_NLI_MODEL = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"

# Several short, specific hypotheses per fact; a fact survives if ANY is entailed.
# Long "X or Y" hypotheses and vague ones ("a structure is damaged") tested badly on the
# dev examples (false passes on "the lift is broken"), so they're not used.
HAZARD_HYPOTHESES = {
    "flooding": ["There is flooding.", "Water is rising.", "There is water on the floor."],
    "bad_air": ["There is smoke.", "There is gas.", "The air is bad.", "It is hard to breathe."],
    "bad_water": ["The water is dirty.", "The water smells bad.", "The water is contaminated."],
    "heat": ["It is hot.", "It is very hot."],
    "blackout": ["The power is out.", "The lights are out."],
    "collapse": ["Something collapsed.", "The ceiling fell.", "A wall is cracked."],
}


@dataclass
class Fact:
    name: Literal["level", "people_count", "injuries", "hazard"]
    value: int | str
    hypotheses: list[str]


def with_keyword_facts(record: Extraction, text: str) -> Extraction:
    """Fill gaps in the triage record with what the keyword rules find in the same text.
    Small models miss facts (a level, a count); an extra fact only makes the fact
    check stricter, so the worst case is sending the full message."""
    kw = keyword_extract(text)
    fill = {f: getattr(kw, f) for f in ("level", "people_count", "injuries", "hazard")
            if getattr(record, f) is None and getattr(kw, f) is not None}
    return record.model_copy(update=fill)


def facts_of(record: Extraction) -> list[Fact]:
    """The critical facts the original message stated (from its triage record)."""
    out = []
    if record.level is not None:
        out.append(Fact("level", record.level, [f"This is on level {record.level}."]))
    if record.people_count:
        n = record.people_count
        noun = "person" if n == 1 else "people"
        out.append(Fact("people_count", n, [f"There {'is' if n == 1 else 'are'} {n} {noun}.",
                                            f"{n} {noun} {'is' if n == 1 else 'are'} affected.",
                                            f"{n} {noun} {'is' if n == 1 else 'are'} trapped."]))
    if record.injuries:
        n = record.injuries
        out.append(Fact("injuries", n, [f"{n} {'person is' if n == 1 else 'people are'} injured.",
                                        f"{n} {'person is' if n == 1 else 'people are'} hurt."]))
    if record.hazard in HAZARD_HYPOTHESES:
        out.append(Fact("hazard", record.hazard, HAZARD_HYPOTHESES[record.hazard]))
    return out


# --------------------------------------------------------------------------- NLI

class NLIUnavailable(RuntimeError):
    pass


class Scorer(Protocol):
    def entailment(self, premise: str, hypotheses: list[str]) -> list[float]: ...


class DebertaNLI:
    """Probability that each hypothesis is entailed by the premise. Loaded once, lazily."""

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.getenv("NLI_MODEL", DEFAULT_NLI_MODEL)
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            self._torch = torch
            self._tok = AutoTokenizer.from_pretrained(self.model_name)
            self._model = AutoModelForSequenceClassification.from_pretrained(self.model_name).eval()
        except Exception as e:  # not installed, not downloaded and offline, ...
            raise NLIUnavailable(f"couldn't load NLI model {self.model_name}: {e}") from e
        labels = {v.lower(): k for k, v in self._model.config.id2label.items()}
        self._entail = labels.get("entailment", 0)

    def entailment(self, premise: str, hypotheses: list[str]) -> list[float]:
        if not hypotheses:
            return []
        batch = self._tok([premise] * len(hypotheses), hypotheses, return_tensors="pt", padding=True, truncation=True)
        with self._torch.no_grad():
            probs = self._model(**batch).logits.softmax(-1)
        return probs[:, self._entail].tolist()


@lru_cache(maxsize=1)
def default_scorer() -> DebertaNLI:
    return DebertaNLI()


@dataclass
class Check:
    passed: bool
    missing: list[str] = field(default_factory=list)  # names of facts that didn't survive
    reason: str = ""


def verify(facts: list[Fact], packet: str, scorer: Scorer | None = None) -> Check:
    """Did every fact survive into the packet? Fails closed if the NLI model is unavailable.

    - level / people / injuries: the number must appear IN CONTEXT ("level 38", "3 kids",
      "2 ... hurt"; code check) AND the NLI model must entail one of the fact's hypotheses
    - hazard: the NLI model must entail one of the hazard's hypotheses
    """
    if not facts:
        return Check(True)
    missing = [f.name for f in facts if f.name != "hazard" and not _carries(packet, f)]
    hypotheses = [h for f in facts for h in f.hypotheses]
    try:
        scores = iter((scorer or default_scorer()).entailment(packet, hypotheses))
    except NLIUnavailable as e:
        return Check(False, [f.name for f in facts], str(e))
    for f in facts:
        best = max(next(scores) for _ in f.hypotheses)
        if best < ENTAIL_THRESHOLD and f.name not in missing:
            missing.append(f.name)
    return Check(not missing, missing)


# --------------------------------------------------------------------------- candidates

_NUMBER_WORDS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15",
    "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50",
}
# Dropped when squeezing: pure filler only. Grammar words ("is", "are", "the") stay, because
# telegraphic text ("9 of us in now") confused the fact checker on dev examples.
# Never negations ("no", "not", "can't"): those flip meaning.
_FILLER = {
    "just", "really", "very", "um", "uh", "like", "actually", "basically", "literally", "honestly",
    "please", "pls", "think", "guess", "maybe", "kind", "sort", "well", "okay", "ok", "oh", "anyway",
    "hello", "hi", "hey", "sorry",
}
_FACT_WORDS = re.compile(
    r"\b(level|lvl|trapped|injur\w*|hurt|bleed\w*|flood\w*|water|smoke|gas|fire|collaps\w*|"
    r"breath\w*|unconscious|people|kids|children|of us|sick|fever|dead|dying|help)\b", re.I)


def _digits(text: str) -> str:
    return re.sub(r"\b(" + "|".join(_NUMBER_WORDS) + r")\b",
                  lambda m: _NUMBER_WORDS[m.group(0).lower()], text, flags=re.I)


def _fit(text: str, budget: int) -> str:
    """Cut at a word boundary so the UTF-8 bytes fit the budget."""
    if len(text.encode()) <= budget:
        return text
    words, out = text.split(), ""
    for w in words:
        nxt = f"{out} {w}".strip()
        if len(nxt.encode()) > budget:
            break
        out = nxt
    return out


HAZARD_WORDS = {
    "flooding": r"flood\w*|water (is )?(rising|coming)|knee|waist|chest",
    "bad_air": r"smoke|gas|fumes|can'?t breathe|no air",
    "bad_water": r"water (tastes|smells)|brown water|contaminat\w*|poison\w*",
    "heat": r"heat|hot|overheat\w*|steam",
    "blackout": r"blackout|power|lights? (are )?out",
    "collapse": r"collaps\w*|cave[- ]?in|rubble|came down|gave way",
}


_PEOPLE_NOUNS = r"(people|ppl|persons?|of us|us|kids|children|child|adults|men|women|families|workers|miners|residents|others)"
_INJURY_WORDS = r"(injur\w*|hurt|wounded|bleed\w*|burn\w*|broken|cut|crushed)"


def _carries(clause: str, fact: Fact) -> bool:
    """Does this clause state this fact? Numbers only count in context, so
    "2 hours ago" doesn't pass for "2 people injured"."""
    c = clause.lower()
    if fact.name == "level":
        return bool(re.search(rf"\b(level|lvl|lv|l)\s*-?\s*{fact.value}\b", c))
    if fact.name == "people_count":
        return bool(re.search(rf"\b{fact.value}\s+(\w+\s+){{0,2}}{_PEOPLE_NOUNS}\b", c))
    if fact.name == "injuries":
        return bool(re.search(rf"\b{fact.value}\b(\s+\w+){{0,10}}\s+{_INJURY_WORDS}", c)
                    or re.search(rf"{_INJURY_WORDS}(\s+\w+){{0,3}}\s+{fact.value}\b", c))
    rx = HAZARD_WORDS.get(str(fact.value))
    return bool(rx and re.search(rx, c))


def squeeze(text: str, budget: int = BUDGET_BYTES, facts: list[Fact] | None = None) -> str:
    """Rule-based shortening.

    Clauses are tightened (number words to digits, filler dropped), then chosen
    greedily: first whichever clause carries the most still-uncovered facts per
    byte, until every fact is covered; then other fact-bearing clauses while
    there's room. Chosen clauses keep their original order.
    """
    text = _digits(re.sub(r"\s+", " ", text)).strip()
    # Work in clauses (split at . ! ? , ; : and before because/when/but/which/while) so one
    # fact doesn't drag a whole long sentence along: "3 kids are trapped in the pump room"
    # can go without "because the door jammed when the power flickered".
    clauses = [c.strip() for c in re.split(
        r"(?<=[.!?,;:])\s+|\n+|\s+(?=(?:because|when|but|which|while|so that)\b)", text) if c and c.strip()]

    def tighten(s: str) -> str:
        kept = [w for w in s.split() if w.lower().strip(",.!?;:'\"") not in _FILLER]
        return re.sub(r"([!?.,])\1+", r"\1", " ".join(kept))

    pool = [(i, tighten(c)) for i, c in enumerate(clauses)]
    pool = [(i, s) for i, s in pool if s]
    facts = facts or []
    uncovered, chosen, used = list(facts), [], 0

    def room(s: str) -> bool:  # +2 for a ", " joiner between clauses
        return used + len(s.encode()) + (2 if chosen else 0) <= budget

    while uncovered:
        best = max(
            ((i, s, sum(_carries(s, f) for f in uncovered)) for i, s in pool if room(s)),
            key=lambda x: (x[2] / len(x[1].encode()), -x[0]),
            default=None,
        )
        if best is None or best[2] == 0:
            break
        i, s, _ = best
        chosen.append((i, s))
        used += len(s.encode()) + (2 if len(chosen) > 1 else 0)
        pool.remove((i, s))
        uncovered = [f for f in uncovered if not _carries(s, f)]

    for i, s in sorted(pool, key=lambda x: x[0]):  # fill leftover room with fact-bearing clauses only
        if (_FACT_WORDS.search(s) or re.search(r"\d", s)) and room(s):
            chosen.append((i, s))
            used += len(s.encode()) + (2 if len(chosen) > 1 else 0)

    if not chosen:  # even one sentence is too long: cut the one carrying the most facts to fit
        first = max(pool, key=lambda x: (sum(_carries(x[1], f) for f in facts), -x[0]))[1] if pool else text
        return _fit(first, budget)
    out = ""
    for _, c in sorted(chosen):
        out = c if not out else out + (" " if out[-1] in ".,!?;:" else ", ") + c
    return _fit(out.rstrip(",;: "), budget)


REWRITE_PROMPT = """Shorten this emergency message to at most {chars} characters.
Keep every one of these exactly: the level number, how many people, how many are injured, and the danger.
Write the level as "level N" and use digits for numbers. Plain words, no abbreviations.
Reply with only the shortened message.

Message: {text}"""


def model_rewrite(text: str, chars: int, client: httpx.Client) -> str:
    prompt = REWRITE_PROMPT.format(chars=chars, text=text)
    if backend() == "cloud":
        model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
        r = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
            json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0}},
            timeout=30,
        )
        r.raise_for_status()
        out = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    else:
        r = client.post(
            f"{os.getenv('OLLAMA_URL', 'http://localhost:11434')}/api/generate",
            json={"model": os.getenv("OLLAMA_MODEL", "llama3.2:3b"), "prompt": prompt, "stream": False,
                  "options": {"temperature": 0}},
            timeout=30,
        )
        r.raise_for_status()
        out = r.json()["response"]
    return re.sub(r"\s+", " ", out).strip().strip('"')


# --------------------------------------------------------------------------- compress

@dataclass
class Packet:
    text: str | None  # None when full=True
    method: Literal["original", "squeeze", "model", "full"]
    full: bool
    bytes: int
    tried: list[tuple[str, list[str]]] = field(default_factory=list)  # (method, facts missing) per rejected try
    reason: str = ""


def compress(
    text: str,
    record: Extraction,
    budget: int = BUDGET_BYTES,
    scorer: Scorer | None = None,
    use_model: bool = True,
    client: httpx.Client | None = None,
) -> Packet:
    facts = facts_of(with_keyword_facts(record, text))
    tried: list[tuple[str, list[str]]] = []
    reason = ""

    def attempt(method, candidate):
        nonlocal reason
        if not candidate or len(candidate.encode()) > budget:
            tried.append((method, ["too long"] if candidate else ["empty"]))
            return None
        check = verify(facts, candidate, scorer)
        if check.passed:
            return Packet(candidate, method, False, len(candidate.encode()), tried)
        tried.append((method, check.missing))
        reason = check.reason or reason
        return None

    if len(text.encode()) <= budget and (p := attempt("original", text)):
        return p
    if p := attempt("squeeze", squeeze(text, budget, facts)):
        return p
    if use_model and not reason:  # skip the model if the fact checker itself is down
        own = client is None
        client = client or httpx.Client()
        try:
            for _ in range(2):
                try:
                    candidate = model_rewrite(text, budget - 20, client)
                except (httpx.HTTPError, KeyError, IndexError, ValueError):
                    tried.append(("model", ["model error"]))
                    continue
                if p := attempt("model", candidate):
                    return p
        finally:
            if own:
                client.close()
    return Packet(None, "full", True, len(text.encode()), tried, reason or "no candidate kept every fact")
