"""Veritas NLP engine — taxonomy, lexicons and constants.

Safety-first design (BRD §6):
  * No binary fake/real verdicts — a graded taxonomy only.
  * Asymmetric error cost: contradicting true content must be hard.
"""

from __future__ import annotations

MODEL_VERSION = "veritas-nlp-1.0.0"
DATA_VERSION = "liar-2017-12k"

# ── Graded verdict taxonomy (BRD §6.1) ──────────────────────────────────────
SUPPORTED = "Supported"
CONTRADICTED = "Contradicted"
MISLEADING = "Misleading"          # displayed as "Misleading / Missing Context"
UNVERIFIED = "Unverified"          # displayed as "Unverified – Insufficient Evidence"
NOT_ASSESSABLE = "NotAssessable"   # displayed as "Opinion / Satire (not assessable)"

TAXONOMY = [SUPPORTED, CONTRADICTED, MISLEADING, UNVERIFIED, NOT_ASSESSABLE]

# LIAR rating → taxonomy (see data/raw/PROVENANCE.md)
RATING_TO_TAXONOMY = {
    "true": SUPPORTED,
    "mostly-true": SUPPORTED,
    "half-true": MISLEADING,
    "barely-true": MISLEADING,
    "false": CONTRADICTED,
    "pants-fire": CONTRADICTED,
}

# Direction score on [-1, +1] used for evidence aggregation
RATING_TO_DIRECTION = {
    "true": 1.0,
    "mostly-true": 0.6,
    "half-true": 0.0,
    "barely-true": -0.3,
    "false": -0.8,
    "pants-fire": -1.0,
}

RATING_DISPLAY = {
    "true": "True",
    "mostly-true": "Mostly True",
    "half-true": "Half True",
    "barely-true": "Mostly False",
    "false": "False",
    "pants-fire": "Pants on Fire",
}

# ── Safety thresholds (tuned on the validation split; see calibration.py) ──
EVIDENCE_SIMILARITY_FLOOR = 0.12   # below → no evidence → forced abstain (BR-03/05)
CONF_SUPPORTED = 0.60              # calibrated confidence floor for Supported
CONF_MISLEADING = 0.55              # floor for Misleading / Missing Context
CONF_CONTRADICTED = 0.70            # higher bar — asymmetric error cost (BRD §6.5)
TOP_K_EVIDENCE = 5
EXACT_DUPLICATE_SIM = 0.97          # treated as "previously fact-checked"
NEAR_DUPLICATE_SIM = 0.90          # for BR-08 reuse of human verdicts

# Style signal lexicons — SECONDARY indicators only (BR-07): display-only.
SENSATIONAL_TERMS = {
    "shocking", "bombshell", "you won't believe", "slams", "destroys", "blasts",
    "explosive", "stunning", "unbelievable", "outrageous", "horrifying",
    "secretly", "exposed", "they don't want you to know", "wake up",
    "mainstream media", "they're hiding", "conspiracy", "cover-up", "coverup",
    "miracle", "instantly", "everyone knows", "nobody talks about",
    "the truth about", "what they won't tell you", "breaking bombshell",
}
EMOTIONAL_TERMS = {
    "angry", "furious", "outraged", "terrifying", "terrified", "panic",
    "fear", "scary", "disgusting", "hate", "evil", "corrupt", "betrayed",
    "disaster", "catastrophe", "crisis", "destroyed", "collapse", "chaos",
}
HEDGING_TERMS = {
    "reportedly", "allegedly", "some say", "some people say", "sources say",
    "rumored", "rumoured", "it is said", "apparently", "seems to",
    "many believe", "critics say", "experts believe", "unconfirmed",
}
CLICKBAIT_PATTERNS = [
    "you won't believe", "what happens next", "number {n} will shock you",
    "doctors hate", "this one trick", "the real reason", "is hiding this",
    "they don't want you to know", "gone wrong", "what happened next",
]
OPINION_CUES = {
    "i think", "i believe", "i feel", "in my opinion", "in my view", "my view",
    "personally", "we should", "we must", "ought to", "should not", "shouldn't",
    "the best", "the worst", "greatest", "terrible leader", "good leader",
    "it's time to", "it is time to", "we deserve", "americans deserve",
}
SATIRE_CUES = {
    "the onion", "satire", "not the onion", "the babylon bee", "clickhole",
    "satirical", "a million billion", "obviously kidding", "april fools",
    "area man", "local man", "sources report that", "reporting live from",
}
PREDICTION_CUES = {
    "will happen", "will be", "will get", "will win", "will lose", "will collapse",
    "is going to", "are going to", "by 2030", "by 2040", "by 2050", "next year",
    "next decade", "in the future", "soon replace", "predict", "forecast",
    "expected to", "destined to", "about to",
}
HISTORICAL_MARKERS = {"since", "last year", "last month", "last week", "recently",
                      "in history", "record", "all-time", "today", "currently", "now"}
FAST_CHANGING_TERMS = {
    "unemployment", "economy", "inflation", "gas prices", "stock market",
    "approval rating", "poll", "polls", "approval", "cases", "hospitalizations",
    "approval ratings", "job growth", "gdp", "wages", "spending",
}
HIGH_IMPACT_CATEGORIES: dict[str, set[str]] = {
    "elections": {
        "election", "elections", "ballot", "vote", "votes", "voters", "voting",
        "campaign", "president", "presidential", "senate", "senator", "senate race",
        "congress", "congressman", "congresswoman", "governor", "impeach",
        "impeachment", "primary", "caucus", "electoral",
    },
    "health": {
        "vaccine", "vaccines", "vaccination", "cancer", "covid", "covid-19",
        "coronavirus", "pandemic", "health", "healthcare", "medicine", "medical",
        "fda", "cure", "disease", "measles", "autism", "abortion", "opioid",
        "drug", "drugs", "hospitals", "insurance",
    },
    "public_safety": {
        "killed", "kills", "murder", "attack", "attacks", "terror", "terrorist",
        "crime", "crime rate", "police", "shooting", "gun", "guns", "violence",
        "emergency", "safety", "war", "military", "troops", "nuclear", "weapons",
    },
    "public_figures": {
        "president", "obama", "biden", "trump", "bush", "clinton", "pelosi",
        "schumer", "mcconnell", "senator", "congressman", "congresswoman",
        "governor", "vice president", "supreme court", "justice", "mayor",
        "secretary", "general", "prime minister", "celebrity",
    },
    "finance": {
        "economy", "jobs", "unemployment", "tax", "taxes", "taxed", "stock market",
        "wall street", "budget", "deficit", "debt", "gdp", "recession",
        "inflation", "trade", "tariff", "tariffs", "wages", "social security",
        "medicare", "medicaid",
    },
}
