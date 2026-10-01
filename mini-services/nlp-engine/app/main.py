"""Veritas NLP engine — FastAPI service (port 8001).

All endpoints are stateless; the engine is deterministic and fail-safe.
Consumed by the Next.js application tier (server-to-server). See
ARCHITECTURE.md §6.1 for the contract.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import taxonomy
from .claims import extract_claims, sanitize
from .engine import VeritasEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("veritas")

app = FastAPI(
    title="Veritas NLP Engine",
    version=taxonomy.MODEL_VERSION,
    description="Evidence-first fact-checking engine for the Veritas decision-support platform.",
)

engine: Optional[VeritasEngine] = None


@app.on_event("startup")
async def startup() -> None:
    global engine
    logger.info("Loading LIAR corpus and fitting calibrator…")
    engine = VeritasEngine()
    logger.info(
        "Engine ready — KB=%d statements, contradicted-threshold=%.2f, startup=%.1fs",
        len(engine.kb), engine.contradicted_threshold, engine.startup_seconds,
    )


def _engine() -> VeritasEngine:
    if engine is None:
        raise HTTPException(status_code=503, detail="engine still loading")
    return engine


# ── contracts ───────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=60000)
    url: Optional[str] = None
    topK: int = Field(default=5, ge=1, le=8)


class SimilarRequest(BaseModel):
    text: str
    candidates: List[Dict] = Field(default_factory=list)
    """ranked list size for the dossier Precedent panel (legacy single `match`
    behaviour is unaffected — it always uses the BR-08 near-duplicate gate)."""
    topN: int = Field(default=3, ge=1, le=8)
    minSim: float = Field(default=0.3, ge=0.0, le=1.0)


class SegmentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=60000)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "modelVersion": taxonomy.MODEL_VERSION,
        "kbSize": len(engine.kb) if engine else 0,
        "ready": engine is not None,
    }


@app.post("/v1/analyze")
async def analyze(req: AnalyzeRequest):
    """Full verification pipeline. NEVER raises on bad input — degrades to
    Unverified (fail-safe, BRD §6.8)."""
    try:
        return _engine().analyze(req.text, req.topK)
    except Exception:  # noqa: BLE001 — deliberate fail-safe boundary
        # never leak internal exception details to the API consumer
        logger.exception("analyze failed")
        return {
            "modelVersion": taxonomy.MODEL_VERSION,
            "dataVersion": taxonomy.DATA_VERSION,
            "latencyMs": 0,
            "degraded": True,
            "degradationReason": "internal analysis error",
            "claims": [],
            "highImpact": {"flag": False, "categories": [], "matchedTerms": []},
            "overall": {"label": taxonomy.UNVERIFIED, "confidence": 0.0},
        }


@app.post("/v1/similar")
async def similar(req: SimilarRequest):
    """Near-duplicate lookup (BR-08) + ranked precedent list for the dossier.

    `match` — legacy BR-08 single near-duplicate (above the reuse threshold).
    `matches` — ranked similar claims above `minSim` (Precedent panel; advisory
    only, never auto-applied)."""
    try:
        return {
            "match": _engine().find_near_duplicate(req.text, req.candidates),
            "matches": _engine().find_similar(req.text, req.candidates, req.topN, req.minSim),
        }
    except Exception:  # noqa: BLE001
        return {"match": None, "matches": []}


@app.post("/v1/segment")
async def segment(req: SegmentRequest):
    """Claim extraction ONLY (sentence segmentation + claim-type classification).

    No retrieval, no verdict — used by the precedent search to split a pasted
    multi-claim article into its factual claims before the per-claim
    consistency sweep. Deterministic + fail-safe (empty list on error)."""
    try:
        sanitized = sanitize(req.text)
        extracted = extract_claims(sanitized.text)
        return {
            "sanitization": {
                "flags": sanitized.flags,
                "originalLength": len(req.text),
                "sanitizedLength": len(sanitized.text),
            },
            "claims": [
                {
                    "position": c.position,
                    "text": c.text,
                    "claimType": c.claim_type,
                    "assessable": c.assessable,
                }
                for c in extracted
            ],
        }
    except Exception:  # noqa: BLE001 — segmentation is best-effort, advisory only
        logger.exception("segment failed")
        return {"sanitization": {"flags": [], "originalLength": len(req.text), "sanitizedLength": 0}, "claims": []}


@app.get("/v1/meta")
async def meta():
    card = _engine().model_card()
    card["suggestions"] = _engine().suggestions()
    return card


@app.get("/v1/eval")
async def evaluate():
    """Release-gate metrics computed on the frozen test split (BRD §11)."""
    return _engine().evaluate()
