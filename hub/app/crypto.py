"""Ed25519 signing for events (PyNaCl).

What gets signed (canonical_bytes): the event's SIGNED_FIELDS, leaving out any that are
null, as compact JSON with keys sorted at every depth, UTF-8, non-ASCII left as is:

    json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

The web side (tweetnacl) must produce byte-identical output: sort keys recursively,
drop top-level null/undefined fields, JSON.stringify. Keep floats out of payloads,
since Python and JS print some of them differently. Keys and signatures are base64.

priority is never signed: the hub scores it on arrival and may rescore it.
"""

import base64
import json
from typing import Any

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

from .models import SIGNED_FIELDS


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def unb64(text: str) -> bytes:
    return base64.b64decode(text, validate=True)


def canonical_bytes(fields: dict[str, Any]) -> bytes:
    content = {k: fields[k] for k in SIGNED_FIELDS if fields.get(k) is not None}
    return json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def new_key() -> SigningKey:
    return SigningKey.generate()


def public_key(key: SigningKey) -> str:
    return b64(bytes(key.verify_key))


def key_from_b64(seed: str) -> SigningKey:
    """A signing key from its base64 32-byte seed (b64(bytes(key)))."""
    return SigningKey(unb64(seed))


def sign(fields: dict[str, Any], key: SigningKey) -> dict[str, Any]:
    """The same fields with author_pub and sig filled in. For the sim, the box, tests and attacks."""
    signed = {**fields, "author_pub": public_key(key)}
    signed["sig"] = b64(key.sign(canonical_bytes(signed)).signature)
    return signed


def verify(fields: dict[str, Any]) -> bool:
    """True if fields["sig"] is a valid signature by fields["author_pub"] over canonical_bytes."""
    try:
        VerifyKey(unb64(fields["author_pub"])).verify(canonical_bytes(fields), unb64(fields["sig"]))
        return True
    except (BadSignatureError, ValueError, TypeError, KeyError):
        return False
