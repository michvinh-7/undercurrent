"""Compression + fact check (Person 3, Upgrade 2).

Compress a message to a 200-byte packet, then use a DeBERTa NLI model to confirm
location, injuries, hazard and count survived. If not: reject and retry, then
send the full message. Never ship a packet that failed the check.

TODO: compress(text) -> bytes, verify(original, packet) -> bool
"""
