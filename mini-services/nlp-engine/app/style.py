"""Secondary signal extraction (BR-07, BR-09).

IMPORTANT SAFETY PROPERTY: every score produced here is DISPLAY-ONLY.
The verdict pipeline in engine.py never reads style scores — writing style
alone can never convict or acquit a claim (BRD §6.3).
"""

from __future__ import annotations

import re
from typing import Dict, List

from . import taxonomy

_EXCLAM_RE = re.compile(r"!")
_CAPS_WORD_RE = re.compile(r"\b[A-Z]{3,}\b")
_TEMPORAL_RE = re.compile(
    r"\b(since|last (year|month|week|decade)|this (year|month|week)|"
    r"20\d{2}|19\d{2}|today|currently|now|recently|record)\b",
    re.IGNORECASE,
)


def style_signals(text: str) -> Dict[str, float | List[str]]:
    """Sensationalism / emotion / hedging / clickbait — 0..1 each, display-only."""
    low = " " + text.lower() + " "
    words = re.findall(r"[a-z']+", low)
    n = max(len(words), 1)
    notes: List[str] = []

    sens_hits = [t for t in taxonomy.SENSATIONAL_TERMS if t in low]
    excl = len(_EXCLAM_RE.findall(text))
    caps_words = [w for w in _CAPS_WORD_RE.findall(text) if w not in {"US", "USA", "UK", "FBI", "CIA", "IRS", "GDP", "CDC", "WHO", "FDA", "CNN", "NBC", "ABC", "CBS"}]
    sensationalism = min(1.0, (len(sens_hits) * 0.28) + (excl * 0.15) + (len(caps_words) * 0.12))
    if sens_hits:
        notes.append(f"Sensational language: {', '.join(sens_hits[:4])}")
    if caps_words:
        notes.append("Shouting-style capitalisation")
    if excl >= 2:
        notes.append(f"{excl} exclamation marks")

    emo_hits = [t for t in taxonomy.EMOTIONAL_TERMS if t in low]
    emotional = min(1.0, len(emo_hits) * 0.22)
    if emo_hits:
        notes.append(f"Emotionally charged terms: {', '.join(emo_hits[:4])}")

    hedge_hits = [t for t in taxonomy.HEDGING_TERMS if t in low]
    hedging = min(1.0, len(hedge_hits) * 0.25)
    if hedge_hits:
        notes.append(f"Unsourced attribution: {', '.join(hedge_hits[:4])}")

    cb_hits = [p for p in taxonomy.CLICKBAIT_PATTERNS if p in low]
    clickbait = min(1.0, len(cb_hits) * 0.34)
    if cb_hits:
        notes.append(f"Clickbait patterns detected")

    return {
        "sensationalism": round(sensationalism, 2),
        "emotional": round(emotional, 2),
        "hedging": round(hedging, 2),
        "clickbait": round(clickbait, 2),
        "notes": notes,
    }


def high_impact(text: str) -> Dict:
    """BR-12: flag topics that require mandatory second human review."""
    low = " " + text.lower() + " "
    categories: List[str] = []
    matched: List[str] = []
    for cat, terms in taxonomy.HIGH_IMPACT_CATEGORIES.items():
        hits = [t for t in terms if f" {t} " in low or f" {t}s " in low]
        if hits:
            categories.append(cat)
            matched.extend(hits[:4])
    return {"flag": bool(categories), "categories": categories, "matchedTerms": matched}


def time_sensitivity(text: str) -> Dict:
    """BR-09: flag fast-moving claims as provisional; report evidence age honestly."""
    low = text.lower()
    temporal = bool(_TEMPORAL_RE.search(text))
    fast = [t for t in taxonomy.FAST_CHANGING_TERMS if f" {t} " in low or f" {t}s " in low]
    return {
        "temporalMarkers": temporal,
        "fastChangingSubject": bool(fast),
        "fastChangingTerms": fast[:4],
    }
