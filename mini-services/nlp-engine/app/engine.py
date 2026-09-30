"""Veritas verification engine.

Retrieval-augmented verification over the LIAR knowledge base of
human-fact-checked statements.

Methodology (see data/raw/PROVENANCE.md and ARCHITECTURE.md §4):
  * train split  — retrieval knowledge base
  * valid split  — Platt confidence calibration + safety-threshold tuning
  * test split   — FROZEN; only ever touched by /v1/eval release gates

The verdict function is TRANSPARENT by design (no black-box stacker):
dominance-filtered weighted vote over retrieved evidence ratings, with
Platt-calibrated confidence. When evidence is weak the system abstains —
that is a feature, not a failure (BRD §6.2 "abstain by default").

Safety properties:
  * No verdict without retrieved evidence (BR-03 / BR-05).
  * Style signals are NEVER consulted by the verdict logic (BR-07).
  * Asymmetric thresholds — Contradicted needs a higher calibrated
    confidence than Supported (BRD §6.5).
  * Near-duplicates of published fact-checks reuse the human verdict (BR-08).
  * Deterministic: same input ⇒ same output (auditability, BRD §6.6).
"""

from __future__ import annotations

import time
import urllib.parse
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import taxonomy
from .calibration import apply_platt, expected_calibration_error, fit_platt
from .claims import ExtractedClaim, extract_claims, sanitize
from .data import KBRecord, load_corpus
from .style import high_impact, style_signals, time_sensitivity

WORD_WEIGHT = 0.65
CHAR_WEIGHT = 0.35
DUPLICATE_STMT_SIM = 0.90   # statement-only similarity ⇒ reuse human verdict (BR-08)
WORD_SIM_CAP = 0.50         # top similarity considered "full strength" evidence
EVIDENCE_STRENGTH_FLOOR = 0.35
CLASSES = [taxonomy.SUPPORTED, taxonomy.MISLEADING, taxonomy.CONTRADICTED]


@dataclass
class RetrievedEvidence:
    record: KBRecord
    similarity: float
    statement_similarity: float = 0.0

    @property
    def is_duplicate(self) -> bool:
        return self.statement_similarity >= DUPLICATE_STMT_SIM


class VeritasEngine:
    def __init__(self) -> None:
        t0 = time.perf_counter()
        self.corpus = load_corpus()
        self.kb: List[KBRecord] = self.corpus["kb"]
        self.n_train = len(self.corpus["splits"]["train"])

        self.word_vec = TfidfVectorizer(
            sublinear_tf=True, ngram_range=(1, 2), min_df=2, stop_words="english",
            max_features=50000, lowercase=True, strip_accents="unicode",
        )
        self.char_vec = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5), min_df=2,
            max_features=80000, lowercase=True, sublinear_tf=True,
        )
        docs = [r.retrieval_doc for r in self.kb]
        self.word_matrix = self.word_vec.fit_transform(docs)
        self.char_matrix = self.char_vec.fit_transform(docs)
        # statement-only channel for BR-08 duplicate reuse (no metadata dilution)
        self.stmt_matrix = self.word_vec.transform([r.statement for r in self.kb])

        self._fit_calibration()
        self._tune_safety_thresholds()

        self.startup_seconds = round(time.perf_counter() - t0, 2)
        self._eval_cache: Optional[Dict] = None

    # ─────────────────────────── retrieval ───────────────────────────

    def _combined_sims(self, text: str) -> np.ndarray:
        w = cosine_similarity(self.word_vec.transform([text]), self.word_matrix)[0]
        c = cosine_similarity(self.char_vec.transform([text]), self.char_matrix)[0]
        return WORD_WEIGHT * w + CHAR_WEIGHT * c

    def _batch_channels(self, texts: List[str], batch: int = 96) -> Tuple[np.ndarray, np.ndarray]:
        """Chunked batch similarity vs the full KB: combined + statement-only."""
        n = len(texts)
        out = np.zeros((n, len(self.kb)), dtype=np.float32)
        stmt_out = np.zeros((n, len(self.kb)), dtype=np.float32)
        for i in range(0, n, batch):
            chunk = texts[i:i + batch]
            wv = self.word_vec.transform(chunk)
            w = cosine_similarity(wv, self.word_matrix)
            c = cosine_similarity(self.char_vec.transform(chunk), self.char_matrix)
            out[i:i + batch] = WORD_WEIGHT * w + CHAR_WEIGHT * c
            stmt_out[i:i + batch] = cosine_similarity(wv, self.stmt_matrix)
        return out, stmt_out

    def retrieve(self, text: str, k: int = taxonomy.TOP_K_EVIDENCE) -> List[RetrievedEvidence]:
        sims = self._combined_sims(text)
        stmt_sims = cosine_similarity(self.word_vec.transform([text]), self.stmt_matrix)[0]
        order = np.argsort(-sims)[:k]
        out = [RetrievedEvidence(self.kb[i], float(sims[i]), float(stmt_sims[i])) for i in order]
        if not any(e.is_duplicate for e in out):
            j = int(np.argmax(stmt_sims))
            if stmt_sims[j] >= DUPLICATE_STMT_SIM and all(e.record.kb_id != self.kb[j].kb_id for e in out):
                out.append(RetrievedEvidence(self.kb[j], float(sims[j]), float(stmt_sims[j])))
        return out

    @staticmethod
    def _topk_from_row(sims_row: np.ndarray, stmt_row: np.ndarray, kb: List[KBRecord],
                       k: int = taxonomy.TOP_K_EVIDENCE) -> List[RetrievedEvidence]:
        idx = np.argpartition(-sims_row, min(k, len(sims_row) - 1))[:k]
        idx = idx[np.argsort(-sims_row[idx])]
        out = [RetrievedEvidence(kb[i], float(sims_row[i]), float(stmt_row[i]))
               for i in idx if sims_row[i] >= 0.0]
        if out and not any(e.is_duplicate for e in out):
            j = int(np.argmax(stmt_row))
            if stmt_row[j] >= DUPLICATE_STMT_SIM and j < len(kb) and all(e.record.kb_id != kb[j].kb_id for e in out):
                out.append(RetrievedEvidence(kb[j], float(sims_row[j]), float(stmt_row[j])))
        return out

    # ─────────────────────────── scoring ───────────────────────────

    def _assess_raw(self, evidence: List[RetrievedEvidence]) -> Dict:
        """Dominance-filtered weighted vote → class fractions + raw confidence.

        Only evidence of comparable strength to the top match (≥ 50% of its
        similarity) participates: weak topic-level matches must not override a
        near-identical fact-check."""
        top_sim = evidence[0].similarity
        cut = 0.5 * top_sim
        voters = [e for e in evidence if e.similarity >= cut] or evidence[:1]
        weights = np.array([e.similarity ** 2 for e in voters])
        classes = [e.record.taxonomy_label for e in voters]
        directions = np.array([taxonomy.RATING_TO_DIRECTION[e.record.rating] for e in voters])

        mass = {c: 0.0 for c in CLASSES}
        for w, c in zip(weights, classes):
            mass[c] += float(w)
        total = sum(mass.values()) or 1e-9
        p = {c: mass[c] / total for c in CLASSES}
        direction = float((weights * directions).sum() / max(weights.sum(), 1e-9))

        strength = min(top_sim / WORD_SIM_CAP, 1.0)
        mult = EVIDENCE_STRENGTH_FLOOR + (1 - EVIDENCE_STRENGTH_FLOOR) * strength
        return {
            "p": p,
            "direction": direction,
            "top_sim": top_sim,
            "raw_conf": max(p.values()) * mult,
            "counts": {c: classes.count(c) for c in set(classes)},
        }

    # ─────────────────────────── calibration & thresholds ───────────────────────────

    def _fit_calibration(self) -> None:
        """Platt scaling fitted on validation (train-only retrieval, no leakage)."""
        valid = self.corpus["calibration_set"]
        self._valid_sims, self._valid_stmt_sims = self._batch_channels(
            [r.statement for r in valid])
        self._valid_sims[:, self.n_train:] = -1.0
        self._valid_stmt_sims[:, self.n_train:] = -1.0

        raws, corrects = [], []
        for i, rec in enumerate(valid):
            ev = self._topk_from_row(self._valid_sims[i], self._valid_stmt_sims[i],
                                     self.kb[: self.n_train])
            if not ev or ev[0].similarity < taxonomy.EVIDENCE_SIMILARITY_FLOOR:
                continue
            if ev[0].is_duplicate:
                continue  # duplicates carry fixed 0.93 confidence, not model confidence
            raw = self._assess_raw(ev)
            pred = max(raw["p"], key=raw["p"].get)
            raws.append(raw["raw_conf"])
            corrects.append(1.0 if pred == rec.taxonomy_label else 0.0)
        self.cal_a, self.cal_b = fit_platt(np.array(raws), np.array(corrects))
        self.calibration_points = len(raws)

    def _tune_safety_thresholds(self) -> None:
        """Asymmetric error cost (BRD §6.5 / gate 1): raise the Contradicted bar
        until the false-positive rate on true content is ≤ 2% on validation."""
        con_t = taxonomy.CONF_CONTRADICTED
        while con_t <= 0.95:
            fpr, judged = self._true_content_fpr(
                taxonomy.CONF_SUPPORTED, taxonomy.CONF_MISLEADING, con_t)
            if judged == 0 or fpr <= 0.02:
                break
            con_t += 0.05
        self.contradicted_threshold = round(min(con_t, 0.95), 2)

        # validation calibration check (reported in the model card)
        confs, corrects = [], []
        for i, rec in enumerate(self.corpus["calibration_set"]):
            verdict = self._verdict_from_evidence(
                self._valid_evidence(i), taxonomy.CONF_SUPPORTED,
                taxonomy.CONF_MISLEADING, self.contradicted_threshold)
            if verdict["abstained"]:
                continue
            confs.append(verdict["confidence"])
            corrects.append(1.0 if verdict["label"] == rec.taxonomy_label else 0.0)
        self.valid_ece = round(expected_calibration_error(
            np.array(confs or [0.0]), np.array(corrects or [0.0])), 3)
        self.valid_calibration_points = len(confs)

    def _true_content_fpr(self, sup_t: float, mis_t: float, con_t: float) -> Tuple[float, int]:
        judged = contradicted = 0
        for i, rec in enumerate(self.corpus["calibration_set"]):
            if rec.taxonomy_label != taxonomy.SUPPORTED:
                continue
            verdict = self._verdict_from_evidence(self._valid_evidence(i), sup_t, mis_t, con_t)
            if verdict["abstained"]:
                continue
            judged += 1
            if verdict["label"] == taxonomy.CONTRADICTED:
                contradicted += 1
        return (contradicted / judged if judged else 0.0), judged

    def _valid_evidence(self, i: int) -> List[RetrievedEvidence]:
        return self._topk_from_row(self._valid_sims[i], self._valid_stmt_sims[i],
                                   self.kb[: self.n_train])

    # ─────────────────────────── verdict logic ───────────────────────────

    def _verdict_from_evidence(self, evidence: List[RetrievedEvidence],
                               sup_t: float, mis_t: float, con_t: float) -> Dict:
        """The safety-critical decision function. Style signals are NOT
        consulted (BR-07). Failing the class-specific bar ⇒ abstention."""
        if not evidence or evidence[0].similarity < taxonomy.EVIDENCE_SIMILARITY_FLOOR:
            best = evidence[0].similarity if evidence else 0.0
            return {
                "label": taxonomy.UNVERIFIED, "confidence": round(min(best, 1.0), 3),
                "abstained": True, "reason": "no_evidence",
                "detail": (
                    f"Best retrieved evidence matched only {best:.0%} of the claim — below our "
                    f"{taxonomy.EVIDENCE_SIMILARITY_FLOOR:.0%} citation floor, so no verdict can be "
                    f"responsibly issued (BR-05)."
                ),
            }
        # near-duplicate of a published fact-check ⇒ reuse the human verdict (BR-08)
        if evidence[0].is_duplicate:
            rec = evidence[0].record
            return {
                "label": rec.taxonomy_label, "confidence": 0.93,
                "abstained": False, "reason": "kb_duplicate",
                "detail": (
                    f"Essentially identical (statement match {evidence[0].statement_similarity:.0%}) to a "
                    f"published PolitiFact ruling rated '{taxonomy.RATING_DISPLAY[rec.rating]}' "
                    f"(speaker: {rec.speaker or 'unknown'}). We reuse the human fact-check rather than re-guessing."
                ),
            }
        raw = self._assess_raw(evidence)
        top_class = max(raw["p"], key=raw["p"].get)
        conf = apply_platt(raw["raw_conf"], self.cal_a, self.cal_b)
        thresholds = {taxonomy.SUPPORTED: sup_t, taxonomy.MISLEADING: mis_t,
                      taxonomy.CONTRADICTED: con_t}
        if conf < thresholds[top_class]:
            return {
                "label": taxonomy.UNVERIFIED, "confidence": round(conf, 3),
                "abstained": True, "reason": "low_confidence",
                "detail": (
                    f"Retrieved evidence leans '{top_class}' but calibrated confidence is only "
                    f"{conf:.0%} — below the {thresholds[top_class]:.0%} safety bar for that verdict. "
                    f"We abstain rather than guess (BR-05)."
                ),
            }
        return {
            "label": top_class, "confidence": round(conf, 3),
            "abstained": False, "reason": "evidence_supported", "detail": raw,
        }

    # ─────────────────────────── explanation ───────────────────────────

    def _explain(self, verdict: Dict, evidence: List[RetrievedEvidence], provisional: bool) -> str:
        """Plain-language explanation (BR-06): which claim, which evidence, why."""
        if verdict["abstained"]:
            return verdict["detail"]
        parts: List[str] = []
        if verdict["reason"] == "kb_duplicate":
            parts.append(verdict["detail"])
        else:
            d = verdict["detail"]
            counts = d.get("counts", {})
            top = evidence[0]
            rec = top.record
            parts.append(
                f"We matched this claim against {len(evidence)} fact-checks from our trusted-source "
                f"registry (PolitiFact)."
            )
            parts.append(
                f"{counts.get(taxonomy.SUPPORTED, 0)} retrieved fact-check(s) support it, "
                f"{counts.get(taxonomy.MISLEADING, 0)} rate similar claims half-true / missing context, "
                f"and {counts.get(taxonomy.CONTRADICTED, 0)} contradict it."
            )
            parts.append(
                f"The strongest match ({top.similarity:.0%} similar) is a statement by "
                f"{rec.speaker or 'a speaker'}"
                + (f" ({rec.speaker_job})" if rec.speaker_job else "")
                + f", rated '{taxonomy.RATING_DISPLAY[rec.rating]}' by PolitiFact"
                + (f" in {rec.context}" if rec.context else "")
                + "."
            )
            parts.append(
                f"Weighing the evidence by similarity strength, the assessment is "
                f"'{verdict['label']}' with calibrated confidence {verdict['confidence']:.0%}."
            )
        if provisional:
            parts.append(
                "This claim concerns a fast-moving subject (e.g. polls, economic figures). Evidence "
                "in the knowledge base is from the 2007–2016 window, so treat this assessment as "
                "provisional and prefer current official figures (BR-09)."
            )
        return " ".join(parts)

    # ─────────────────────────── public API ───────────────────────────

    def analyze(self, text: str, top_k: int = taxonomy.TOP_K_EVIDENCE) -> Dict:
        t0 = time.perf_counter()
        sanitized = sanitize(text)
        claims_out: List[Dict] = []
        high_impact_union = high_impact(sanitized.text)

        extracted: List[ExtractedClaim] = extract_claims(sanitized.text)
        for claim in extracted:
            entry: Dict = {
                "position": claim.position,
                "text": claim.text,
                "claimType": claim.claim_type,
                "assessable": claim.assessable,
                "typeReason": claim.type_reason,
            }
            if not claim.assessable:
                entry["verdict"] = {
                    "label": taxonomy.NOT_ASSESSABLE, "confidence": None,
                    "abstained": False, "reason": "not_assessable",
                    "explanation": (
                        f"Marked '{claim.claim_type}' and therefore not assessable: {claim.type_reason} "
                        "Veritas only assesses factual claims (BR-02)."
                    ),
                    "provisional": False, "evidenceAgeDays": None,
                    "styleSignals": style_signals(claim.text),
                    "sourceReliability": None, "evidence": [],
                }
            else:
                evidence = self.retrieve(claim.text, top_k)
                verdict = self._verdict_from_evidence(
                    evidence, taxonomy.CONF_SUPPORTED, taxonomy.CONF_MISLEADING,
                    self.contradicted_threshold,
                )
                ts = time_sensitivity(claim.text)
                provisional = bool(ts["fastChangingSubject"] or ts["temporalMarkers"])
                evidence_payload = []
                if verdict["reason"] != "no_evidence":
                    for ev in evidence:
                        q = urllib.parse.quote(ev.record.statement[:90])
                        evidence_payload.append({
                            "rank": len(evidence_payload) + 1,
                            "title": f"PolitiFact ruling: {taxonomy.RATING_DISPLAY[ev.record.rating]}",
                            "url": f"https://www.politifact.com/search/?q={q}",
                            "excerpt": ev.record.statement,
                            "similarity": round(ev.similarity, 3),
                            "kbRating": ev.record.rating,
                            "speaker": ev.record.speaker,
                            "speakerJob": ev.record.speaker_job,
                            "context": ev.record.context,
                            "subject": ev.record.primary_subject,
                        })
                entry["verdict"] = {
                    "label": verdict["label"],
                    "confidence": verdict["confidence"],
                    "abstained": verdict["abstained"],
                    "reason": verdict["reason"],
                    "explanation": self._explain(verdict, evidence, provisional),
                    "provisional": provisional,
                    "timeSensitivity": ts,
                    "evidenceAgeDays": None,  # corpus has no per-record dates — honestly reported
                    "styleSignals": style_signals(claim.text),
                    "sourceReliability": 0.90,  # PolitiFact registry score (see Tier 1 registry)
                    "evidence": evidence_payload,
                }
            claim_hi = high_impact(claim.text)
            if claim_hi["flag"]:
                high_impact_union["flag"] = True
                high_impact_union["categories"] = sorted(set(high_impact_union["categories"]) | set(claim_hi["categories"]))
                high_impact_union["matchedTerms"] = sorted(set(high_impact_union["matchedTerms"]) | set(claim_hi["matchedTerms"]))
            claims_out.append(entry)

        overall = self._rollup(claims_out)
        return {
            "modelVersion": taxonomy.MODEL_VERSION,
            "dataVersion": taxonomy.DATA_VERSION,
            "latencyMs": int((time.perf_counter() - t0) * 1000),
            "sanitization": {
                "flags": sanitized.flags,
                "originalLength": sanitized.original_length,
                "sanitizedLength": sanitized.sanitized_length,
            },
            "claims": claims_out,
            "highImpact": high_impact_union,
            "overall": overall,
        }

    @staticmethod
    def _rollup(claims_out: List[Dict]) -> Dict:
        """Overall label by risk priority; the driving claim's confidence carries."""
        priority = [taxonomy.CONTRADICTED, taxonomy.MISLEADING, taxonomy.SUPPORTED]
        best: Optional[Dict] = None
        for entry in claims_out:
            v = entry.get("verdict", {})
            if v.get("abstained") or v.get("label") == taxonomy.NOT_ASSESSABLE:
                continue
            if v["label"] in priority:
                if best is None or priority.index(v["label"]) < priority.index(best["label"]):
                    best = v
        if best is None:
            if claims_out and all(c.get("verdict", {}).get("label") == taxonomy.NOT_ASSESSABLE for c in claims_out):
                return {"label": taxonomy.NOT_ASSESSABLE, "confidence": None}
            return {"label": taxonomy.UNVERIFIED, "confidence": 0.0}
        return {"label": best["label"], "confidence": best.get("confidence")}

    def find_near_duplicate(self, text: str, candidates: List[Dict]) -> Optional[Dict]:
        """BR-08: reuse an existing human-verified verdict when a near-duplicate exists."""
        if not candidates:
            return None
        texts = [c.get("text", "") for c in candidates]
        try:
            mat = self.char_vec.transform([text] + texts)
            sims = cosine_similarity(mat[0:1], mat[1:])[0]
        except ValueError:
            return None
        if len(sims) == 0:
            return None
        i = int(np.argmax(sims))
        if sims[i] >= taxonomy.NEAR_DUPLICATE_SIM:
            out = dict(candidates[i])
            out["similarity"] = round(float(sims[i]), 3)
            return out
        return None

    # ─────────────────────────── release gates (BRD §11) ───────────────────────────

    def evaluate(self) -> Dict:
        if self._eval_cache is not None:
            return self._eval_cache
        t0 = time.perf_counter()
        test = self.corpus["frozen_test"]
        sims, stmt_sims = self._batch_channels([r.statement for r in test])
        sims[:, self.n_train:] = -1.0  # no leakage: train block only
        stmt_sims[:, self.n_train:] = -1.0

        confs, corrects = [], []
        y_true, y_pred = [], []
        n_abstained = 0
        for i, rec in enumerate(test):
            evidence = self._topk_from_row(sims[i], stmt_sims[i], self.kb[: self.n_train])
            verdict = self._verdict_from_evidence(
                evidence, taxonomy.CONF_SUPPORTED, taxonomy.CONF_MISLEADING, self.contradicted_threshold)
            if verdict["abstained"]:
                n_abstained += 1
                continue
            y_true.append(rec.taxonomy_label)
            y_pred.append(verdict["label"])
            confs.append(verdict["confidence"])
            corrects.append(1.0 if verdict["label"] == rec.taxonomy_label else 0.0)

        confs_arr = np.array(confs or [0.0])
        corr_arr = np.array(corrects or [0.0])
        accuracy = float(corr_arr.mean()) if len(corr_arr) else 0.0

        def macro_f1(yt, yp):
            f1s = []
            for cls in CLASSES:
                tp = sum(1 for a, b in zip(yt, yp) if a == cls and b == cls)
                fp = sum(1 for a, b in zip(yt, yp) if a != cls and b == cls)
                fn = sum(1 for a, b in zip(yt, yp) if a == cls and b != cls)
                prec = tp / (tp + fp) if tp + fp else 0.0
                rec = tp / (tp + fn) if tp + fn else 0.0
                f1s.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
            return float(np.mean(f1s)) if f1s else 0.0

        true_idx = [i for i, y in enumerate(y_true) if y == taxonomy.SUPPORTED]
        fp_true = sum(1 for i in true_idx if y_pred[i] == taxonomy.CONTRADICTED)
        fpr_true = fp_true / len(true_idx) if true_idx else 0.0
        con_idx = [i for i, p in enumerate(y_pred) if p == taxonomy.CONTRADICTED]
        con_prec = (sum(1 for i in con_idx if y_true[i] == taxonomy.CONTRADICTED) / len(con_idx)) if con_idx else 1.0
        ece = expected_calibration_error(confs_arr, corr_arr)
        n_test = len(test)

        self._eval_cache = {
            "evaluatedOn": "frozen test split (test.tsv — never used for training/tuning)",
            "nTest": n_test,
            "nJudged": len(y_true),
            "abstentionRate": round(n_abstained / n_test, 3),
            "accuracyNonAbstained": round(accuracy, 3),
            "macroF1NonAbstained": round(macro_f1(y_true, y_pred), 3),
            "contradictedPrecision": round(con_prec, 3),
            "falsePositiveRateOnTrueContent": round(fpr_true, 3),
            "eceNonAbstained": round(ece, 3),
            "latencySeconds": round(time.perf_counter() - t0, 1),
            "gates": {
                "fprTrueContentLe2pct": {"target": 0.02, "actual": round(fpr_true, 3)},
                "contradictedPrecisionGe95pct": {"target": 0.95, "actual": round(con_prec, 3)},
                "macroF1Ge085": {"target": 0.85, "actual": round(macro_f1(y_true, y_pred), 3)},
                "eceLe005": {"target": 0.05, "actual": round(ece, 3)},
            },
        }
        return self._eval_cache

    def model_card(self) -> Dict:
        ratings: Dict[str, int] = {}
        for r in self.kb:
            ratings[r.rating] = ratings.get(r.rating, 0) + 1
        return {
            "modelVersion": taxonomy.MODEL_VERSION,
            "dataVersion": taxonomy.DATA_VERSION,
            "approach": "Retrieval-augmented verification: dual-channel TF-IDF retrieval over the "
                        "LIAR corpus of PolitiFact fact-checks; dominance-filtered weighted vote; "
                        "Platt-calibrated confidence; asymmetric abstention thresholds tuned on "
                        "validation for ≤2% false-positive rate on true content. Near-duplicates "
                        "reuse the published human verdict (BR-08).",
            "kbSize": len(self.kb),
            "kbRatings": ratings,
            "thresholds": {
                "evidenceSimilarityFloor": taxonomy.EVIDENCE_SIMILARITY_FLOOR,
                "confSupported": taxonomy.CONF_SUPPORTED,
                "confMisleading": taxonomy.CONF_MISLEADING,
                "confContradicted": self.contradicted_threshold,
                "nearDuplicateReuse": DUPLICATE_STMT_SIM,
            },
            "calibration": {
                "method": "Platt (2-parameter logistic) on validation split, train-only retrieval",
                "validationPoints": self.valid_calibration_points,
                "validationEce": self.valid_ece,
                "a": round(self.cal_a, 3),
                "b": round(self.cal_b, 3),
            },
            "startupSeconds": self.startup_seconds,
            "corpusChecksums": self.corpus["checksums"],
            "knownLimitations": [
                "US-politics-centric corpus (2007–2016); regional fairness gaps are surfaced, not hidden",
                "Short-claim corpus: long articles are decomposed into claims before retrieval",
                "PolitiFact rulings are human editorial judgments reused as trusted evidence",
                "No live web retrieval in v1 — evidence comes from the licensed KB snapshot",
                "By design the system abstains whenever evidence is weak; abstention rate is high "
                "on novel claims and that is the intended safe behaviour (BRD §6.2)",
            ],
            "safetyProperties": [
                "Graded taxonomy only — no binary fake/real output",
                "Evidence-first: no verdict without a cited source",
                "Style signals are display-only and never affect verdicts",
                "Asymmetric thresholds minimise wrongly labelling true content false",
                "Deterministic engine: same input, same output (auditable)",
            ],
        }

    def suggestions(self, n: int = 6) -> List[Dict]:
        """Demo chips: (a) previously fact-checked statements from the TRAIN split
        exercising the BR-08 duplicate-reuse path, and (b) novel claims that
        honestly demonstrate abstention."""
        picks = [
            ("pants-fire", "fabricated"),
            ("false", "contradicts"),
            ("half-true", "mixed"),
            ("true", "supports"),
            ("mostly-true", "mostly supports"),
        ]
        out = []
        for rating, hint in picks:
            pool = [r for r in self.corpus["splits"]["train"]
                    if r.rating == rating and 60 < len(r.statement) < 160]
            if not pool:
                continue
            rec = pool[len(out) * 7 % len(pool)]  # deterministic spread
            out.append({
                "text": rec.statement,
                "speaker": rec.speaker,
                "trueRating": taxonomy.RATING_DISPLAY[rec.rating],
                "hint": hint,
                "subject": rec.primary_subject,
                "kind": "fact_checked",  # duplicate-reuse path
            })
        out.append({
            "text": "Zorblat Industries announced a quantum widget that reverses gravity.",
            "speaker": "Unknown",
            "trueRating": "Unknown",
            "hint": "abstains (no evidence)",
            "subject": "Technology",
            "kind": "novel",
        })
        return out[:n]
