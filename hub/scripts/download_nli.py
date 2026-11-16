"""Download the fact-check model once so compression works offline.

    hub/.venv/bin/python hub/scripts/download_nli.py

~740 MB, cached by Hugging Face under ~/.cache/huggingface. Run it on every
laptop that will run a hub with compression, while you still have internet.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from app.compress import DebertaNLI  # noqa: E402

nli = DebertaNLI()
score = nli.entailment("Water is rising on level 38 and 3 kids are trapped.", ["This is on level 38."])[0]
print(f"{nli.model_name} ready. Sanity check, 'on level 38' entailed: {score:.2f} (should be high)")
