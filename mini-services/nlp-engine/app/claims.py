"""Claim extraction and classification (BR-01, BR-02).

Deterministic, rule-based NLP: sentence segmentation + claim-type classification
(factual | opinion | satire | prediction). Non-factual claims are marked
"not assessable" — the system never judges opinions or satire (BRD §4).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from . import taxonomy

MAX_CLAIMS = 6
SHORT_INPUT_CHARS = 240

_ABBREV_MAP = {
    "mr.": "mr<dot>", "mrs.": "mrs<dot>", "ms.": "ms<dot>", "dr.": "dr<dot>",
    "prof.": "prof<dot>", "sen.": "sen<dot>", "rep.": "rep<dot>", "gov.": "gov<dot>",
    "gen.": "gen<dot>", "col.": "col<dot>", "sgt.": "sgt<dot>", "st.": "st<dot>",
    "jr.": "jr<dot>", "sr.": "sr<dot>", "vs.": "vs<dot>", "etc.": "etc<dot>",
    "u.s.": "u<dot>s<dot>", "u.k.": "u<dot>k<dot>", "no.": "no<dot>",
    "e.g.": "e<dot>g<dot>", "i.e.": "i<dot>e<dot>", "fig.": "fig<dot>",
    "d.c.": "d<dot>c<dot>",
}
_ABBREV_REV = {v: k for k, v in _ABBREV_MAP.items()}
_SENT_SPLIT = re.compile(r'(?<=[.!?])["\')\]]?\s+(?=[A-Z"\'(\[])')
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MULTI_WS = re.compile(r"[ \t\r\f\v]+")
_INJECTION_RE = re.compile(
    r"ignore (all |any |the )?(previous|prior|above) (instructions?|prompts?|rules?)"
    r"|disregard (all |any |the )?(previous|prior|above)"
    r"|you are now|system prompt|developer message|jailbreak|act as (a|an) different",
    re.IGNORECASE,
)

_FIRST_PERSON = re.compile(r"\b(i|me|my|we|our|us)\b", re.IGNORECASE)
_MENTAL_VERB = re.compile(
    r"\b(think|believe|feel|reckon|guess|suppose|assume|opinion|view)\b", re.IGNORECASE
)
_MODAL_RE = re.compile(
    r"\b(should|shouldn't|should not|must|mustn't|ought|could|might|may)\b", re.IGNORECASE
)
_FUTURE_RE = re.compile(
    r"\b(will|shall|going to|gonna|by 20\d{2}|next (year|decade|century)|in the future|"
    r"about to|expected to|predict\w*|forecast)\b",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(r"\d")
_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]+")
_SUPERLATIVE_RE = re.compile(
    r"\b(most|best|worst|largest|biggest|greatest|highest|lowest|record|all-time|"
    r"first|last|only|every|never|always)\b",
    re.IGNORECASE,
)


@dataclass
class SanitizeResult:
    text: str
    flags: List[str] = field(default_factory=list)
    original_length: int = 0
    sanitized_length: int = 0


def sanitize(text: str, max_chars: int = 20000) -> SanitizeResult:
    """Sanitize + abuse-resistance (BRD §8): caps, control chars, injection scan."""
    original = text or ""
    cleaned = _URL_RE.sub(" ", original)
    cleaned = _CONTROL_RE.sub("", cleaned)
    cleaned = _MULTI_WS.sub(" ", cleaned).strip()
    flags: List[str] = []
    if len(original) > max_chars:
        cleaned = cleaned[:max_chars]
        flags.append("length_truncated")
    if _INJECTION_RE.search(original):
        # flag but do not silently alter meaning — reviewers must see it
        flags.append("prompt_injection_patterns")
    if not cleaned:
        flags.append("empty_after_sanitization")
    return SanitizeResult(
        text=cleaned,
        flags=flags,
        original_length=len(original),
        sanitized_length=len(cleaned),
    )


@dataclass
class ExtractedClaim:
    position: int
    text: str
    claim_type: str            # factual | opinion | satire | prediction
    assessable: bool
    type_reason: str


def _classify_sentence(sent: str) -> tuple[str, str]:
    low = " " + sent.lower() + " "

    if any(cue in low for cue in taxonomy.SATIRE_CUES):
        return "satire", "Contains satire markers (parody outlet or absurdist framing)."
    caps_words = re.findall(r"\b[A-Z]{4,}\b", sent)
    if len(caps_words) >= 2:
        return "satire", "Multiple shouting-style ALL-CAPS words — characteristic of parody."

    if _FUTURE_RE.search(sent):
        # Predictions about the future are not verifiable today (BR-02).
        return "prediction", "Forward-looking statement — outcomes have not occurred yet."

    opinion_cue = any(cue in low for cue in taxonomy.OPINION_CUES)
    has_mental = _FIRST_PERSON.search(sent) and _MENTAL_VERB.search(sent)
    strong_modal = _MODAL_RE.search(sent)
    has_anchor = bool(_NUMBER_RE.search(sent) or _PROPER_NOUN_RE.search(sent))
    if opinion_cue or (has_mental and not has_anchor):
        return "opinion", "Subjective framing / first-person value judgment (BR-02: opinions are not assessable)."
    if strong_modal and not has_anchor:
        return "opinion", "Normative modal claim without checkable anchors — opinion-like."
    if any(cue in low for cue in taxonomy.HEDGING_TERMS) and not has_anchor:
        return "opinion", "Unsourced attribution with no factual anchor."

    return "factual", "Declarative statement with checkable content (entities, quantities or events)."


def _informativeness(sent: str) -> float:
    """Rank claims so the most checkable ones are kept (numbers > names > superlatives)."""
    score = 0.0
    score += 0.5 * min(len(_NUMBER_RE.findall(sent)), 3)
    score += 0.3 * min(len(_PROPER_NOUN_RE.findall(sent)), 5)
    score += 0.4 if _SUPERLATIVE_RE.search(sent) else 0.0
    score += min(len(sent) / 200.0, 1.0) * 0.3
    return score


# discourse markers / interjections that prefix otherwise checkable claims
_LEADIN_RE = re.compile(
    r"^(breaking|shocking|exclusive|watch|update|report|report:|wow|must read|"
    r"developing|alert|just in|new|video|opinion|analysis|fact check)\s*[:\-–—]\s*",
    re.IGNORECASE,
)
_QUOTES_RE = re.compile(r"^[\s\"'\u201c\u2018(\[]+(.*?)[\s\"'\u201d\u2019)\]]*$", re.DOTALL)


def _normalize_claim(sent: str) -> str:
    """Strip discourse markers ("SHOCKING:", "BREAKING -") and wrapping quotes so
    retrieval compares the underlying claim, not the packaging."""
    prev = None
    s = sent.strip()
    while prev != s:
        prev = s
        s = _LEADIN_RE.sub("", s).strip()
    m = _QUOTES_RE.match(s)
    if m and m.group(1):
        s = m.group(1).strip()
    return _MULTI_WS.sub(" ", s)


def _split_sentences(text: str) -> List[str]:
    """Abbreviation-aware sentence splitting (deterministic)."""
    protected = text
    for k, v in _ABBREV_MAP.items():
        protected = re.sub(r"\b" + re.escape(k) + r"\b", v, protected, flags=re.IGNORECASE)
    parts = [s.strip() for s in _SENT_SPLIT.split(protected) if s and s.strip()]
    restored = []
    for p in parts:
        for k, v in _ABBREV_REV.items():
            p = p.replace(k, v.capitalize() if p.startswith(k) else v)
        restored.append(p.strip(" "))
    return [r for r in restored if r]


def extract_claims(text: str) -> List[ExtractedClaim]:
    """Split input into discrete checkable claims (BR-01) and classify (BR-02)."""
    text = (text or "").strip()
    if not text:
        return []

    if len(text) <= SHORT_INPUT_CHARS and len(_split_sentences(text)) <= 1:
        norm = _normalize_claim(text)
        ctype, reason = _classify_sentence(norm)
        return [ExtractedClaim(0, norm, ctype, ctype == "factual", reason)]

    sentences = [s for s in _split_sentences(text) if len(s) > 12]
    sentences = [_normalize_claim(s) for s in sentences]
    sentences = [s for s in sentences if len(s) > 8]
    # merge fragments: a fragment without terminal punctuation attached to previous
    merged: List[str] = []
    for s in sentences:
        if merged and (len(s) < 25 and not _NUMBER_RE.search(s) and not _PROPER_NOUN_RE.search(s)):
            merged[-1] += " " + s
        else:
            merged.append(s)

    classified: List[tuple[float, ExtractedClaim]] = []
    for idx, sent in enumerate(merged):
        ctype, reason = _classify_sentence(sent)
        claim = ExtractedClaim(idx, sent, ctype, ctype == "factual", reason)
        classified.append((_informativeness(sent) if ctype == "factual" else 0.05, claim))

    if not classified:
        ctype, reason = _classify_sentence(text)
        return [ExtractedClaim(0, text, ctype, ctype == "factual", reason)]

    # keep the most informative factual claims, but always keep ALL type results if few
    factual = [c for c in classified if c[1].claim_type == "factual"]
    others = [c for c in classified if c[1].claim_type != "factual"]
    keep_factual = sorted(factual, key=lambda c: c[0], reverse=True)[:MAX_CLAIMS]
    kept = sorted(keep_factual + others[:2], key=lambda c: c[1].position)
    return [c[1] for c in kept]
