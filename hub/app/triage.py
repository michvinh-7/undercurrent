"""AI triage (Person 2).

Messy text in, structured record + priority out. Local model via Ollama; if its
JSON is broken, retry once, then fall back to keyword rules. Broken data never
reaches the screen. The model never does math or invents numbers.
"""

import json
import os
import re

import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

PROMPT = """You triage emergency messages from an underground city. Reply with JSON only:
{{"type": "checkin|hazard|case|missing_person", "level": <1-40 or null>, "injuries": <int>,
"hazard": "<short text or null>", "people_count": <int>, "priority": <0.0-1.0>}}
Message: {text}"""

# Order matters: strongest signal first. Placeholder weights; tune on the dev set, never the test set.
_RULES: list[tuple[re.Pattern, float]] = [
    (re.compile(r"\b(sos|help|trapped|dying|bleeding|unconscious|can't breathe)\b", re.I), 0.95),
    (re.compile(r"\b(flood|collapse|fire|gas|outbreak|fever|injur)", re.I), 0.7),
    (re.compile(r"\b(missing|lost|haven't seen)\b", re.I), 0.5),
]


def keyword_triage(text: str) -> dict:
    """Fallback ranking when the model is slow or its output is unusable."""
    priority = next((p for rx, p in _RULES if rx.search(text)), 0.1)
    level = re.search(r"level\s*(\d{1,2})", text, re.I)
    return {
        "type": "case" if priority >= 0.7 else "checkin",
        "level": int(level.group(1)) if level else None,
        "injuries": None,
        "hazard": None,
        "people_count": None,
        "priority": priority,
        "source": "keywords",
    }


def _ask_model(text: str) -> dict:
    r = httpx.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": OLLAMA_MODEL, "prompt": PROMPT.format(text=text), "format": "json", "stream": False},
        timeout=30,
    )
    r.raise_for_status()
    data = json.loads(r.json()["response"])
    data["priority"] = min(1.0, max(0.0, float(data["priority"])))
    return data


def triage(text: str) -> dict:
    for _ in range(2):  # first try + one retry
        try:
            return {**_ask_model(text), "source": "model"}
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            continue
    return keyword_triage(text)
