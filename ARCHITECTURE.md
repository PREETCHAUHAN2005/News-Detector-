# Veritas — Fake News Detection using NLP
## System Architecture Document (v1.0)

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Date | 30 September 2026 |
| Status | Approved (auto-approved after full BRD coverage review — see §12 Traceability Matrix) |
| Classification | Internal |
| Implements | BRD “Fake News Detection using Natural Language Processing” v1.0 |

---

## 1. Purpose & Design Philosophy

Veritas is a **decision-support system for fact-checkers**, not an automated judge. Every architectural decision follows the BRD’s core position (§2 of BRD):

> *The system is a decision-support tool, not an automated judge. Every requirement favours caution, transparency and human oversight over raw automation.*

Four non-negotiable pillars derived from the BRD drive this architecture:

1. **Graded verdicts, never binary “fake/real”** — taxonomy: `Supported`, `Contradicted`, `Misleading / Missing Context`, `Unverified – Insufficient Evidence`, `Opinion/Satire (not assessable)`.
2. **Evidence-first** — no verdict without retrieved, cited evidence. Style signals are secondary indicators displayed but never able to flip a verdict.
3. **Abstain by default** — below a calibrated confidence threshold the system returns *Unverified – Insufficient Evidence* instead of guessing. Fail-safe degradation routes to humans, never to a confident verdict.
4. **Human-in-the-loop** — reviewers accept/edit/reject recommendations; high-impact cases require a second review; everything is audit-logged and appealable.

---

## 2. Architecture Style & Topology

**Style:** Gateway-fronted two-service architecture (UI/Business tier + ML tier) with a shared relational store owned by the business tier.

**Rationale:**
- The ML pipeline (retrieval, classification, calibration) is a **stateless compute function** — best served by Python (the lingua franca of NLP with scikit-learn).
- Workflow, governance, persistence and UI are **stateful business logic** — best served by TypeScript/Next.js (single language across client and server, types end-to-end).
- Keeping ML behind an HTTP boundary isolates model failures (fail-safe, BRD §6.8), allows independent versioning of `modelVersion` (maintainability NFR), and keeps the sandbox topology simple (one gateway, two services, one DB).

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Browser (User / Reviewer)                      │
│         Single-page app shell — all views rendered client-side            │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  relative URLs (same-origin)
┌───────────────────────────────▼──────────────────────────────────────────┐
│                     Caddy Gateway  (port 81)                               │
│   /                        → Next.js App Router        (port 3000)        │
│   ?XTransformPort=8001     → Python NLP Engine         (port 8001)        │
└───────────┬────────────────────────────────────────────┬─────────────────┘
            │                                            │
┌───────────▼─────────────────────────┐    ┌────────────▼──────────────────┐
│  TIER 1 — Application (TypeScript)   │    │  TIER 2 — ML Engine (Python)   │
│  Next.js 16 App Router, port 3000    │    │  FastAPI + scikit-learn, 8001  │
│ ───────────────────────────────────  │    │ ────────────────────────────── │
│  • UI shell (Cursor-style dark)      │    │  POST /v1/analyze              │
│  • API routes (all client-facing)    │───▶│   1. sanitize + injection scan │
│  • NextAuth credentials + RBAC       │HTTP│   2. claim extraction          │
│  • Rate limiting (token bucket)      │    │   3. evidence retrieval        │
│  • Persistence: Prisma + SQLite      │    │   4. graded verdict + conf.   │
│  • Audit logging, review workflow,   │    │   5. temperature-scaled calib │
│    appeals, analytics aggregation    │    │   6. abstention gate          │
│  • Dedup (near-duplicate reuse)      │    │   7. style signals (secondary)│
└───────────┬─────────────────────────┘    │  POST /v1/similar (dedup KB)  │
            │                              │  GET  /v1/meta (model card)   │
┌───────────▼─────────────────────────┐    │  GET  /v1/eval (golden gates) │
│  Store: SQLite via Prisma            │    │  GET  /healthz                │
│  (Analyses, Claims, Verdicts,        │    └────────────┬──────────────────┘
│   Evidence, Reviews, Appeals,        │                 │
│   AuditLogs, Feedback, Users,        │    ┌────────────▼──────────────────┐
│   TrustedSources)                    │    │  Knowledge Base (read-only)    │
└─────────────────────────────────────┘    │  LIAR corpus (PolitiFact)      │
                                           │  12,836 human-fact-checked     │
                                           │  statements w/ 6-way ratings    │
                                           └────────────────────────────────┘
```

**Key topology rules (sandbox-safe):**
- The browser **only** talks to the gateway via relative URLs; cross-tier calls carry `?XTransformPort=8001` only if invoked from the browser. In practice the browser never calls the ML tier directly — all ML calls are made **server-side** from Next.js API routes to `http://localhost:8001`, which prevents any model-metadata leakage to clients and enforces the rate-limit/auth boundary in one place.
- The ML engine is **stateless** — it can be restarted or rolled back (`modelVersion` stamped on every verdict) without data loss.

---

## 3. Technology Stack (and why it is the safest choice)

| Layer | Technology | Version | License | Why |
| --- | --- | --- | --- | --- |
| UI + Business tier | Next.js 16 (App Router) + TypeScript 5 | 16.x / 5.x | MIT | Types end-to-end; RSC + client shell; industry standard |
| UI components | shadcn/ui + Tailwind CSS 4 | latest | MIT | Accessible (WCAG-friendly primitives), consistent dark theme |
| Charts | Recharts | 2.x | MIT | Ops dashboards (BR-16/17) |
| State | Zustand | 5.x | MIT | Minimal client-side view state |
| Auth | NextAuth v4 (Credentials) | 4.x | ISC | Mature, session cookies, RBAC hook |
| ORM/Store | Prisma + SQLite | 6.x | Apache-2.0 | Typed persistence, migrations, audit-friendly |
| ML tier | Python 3.12 + FastAPI | 0.12x | MIT/PSF | Async, OpenAPI, pydantic-validated contracts |
| ML libraries | scikit-learn + NumPy | 1.5 / 2.x | BSD-3 | Battle-tested, no deep-learning weight risk, deterministic, auditable |
| Data | LIAR corpus (PolitiFact, UCSB) | 12.8k | CC BY 4.0 (research use) | Public benchmark with **graded** truthfulness labels — matches the BRD taxonomy |

**Explicitly avoided:** LLM-as-judge for verdicts (non-deterministic, unverifiable — violates “no false truth”), deep-learning stacks (unauditable black box for v1), binary classifiers (violates graded-taxonomy principle), any package with viral/copyleft licenses.

---

## 4. The NLP Verification Pipeline (Tier 2, Python)

The pipeline is **retrieval-augmented verification**: a claim is checked against a knowledge base of human-fact-checked statements (PolitiFact via LIAR). This is the “evidence-first” architecture — the model literally cannot produce a verdict without retrieved evidence.

```
 input text
    │
    ▼
[1] SANITIZE — cap length, strip control chars, prompt-injection scan (flag only)
    │
    ▼
[2] CLAIM EXTRACTION (BR-01, BR-02)
    │   sentence segmentation → per-sentence classification:
    │   factual | opinion | satire | prediction  (cue-phrase + subjectivity heuristics)
    │   non-factual ⇒ label "not assessable"
    ▼
[3] EVIDENCE RETRIEVAL (BR-03)  — per factual claim
    │   TF-IDF dual-channel: word (1–2 gram, sublinear) 65% + char_wb (3–5 gram) 35%
    │   cosine similarity vs KB (statement + subject + speaker + context fields)
    │   top-k = 5, similarity floor = 0.12  ⇒ no evidence ⇒ forced abstain
    ▼
[4] VERDICT REASONING (BR-04, BR-07)
    │   neighbour vote weighted by sim² × source-trust prior
    │   KB rating → taxonomy map:
    │     true, mostly-true            → SUPPORTED
    │     half-true, barely-true       → MISLEADING / MISSING CONTEXT
    │     false, pants-fire            → CONTRADICTED
    │   direction score = Σ(sim²·s) for support − Σ(sim²·s) against
    ▼
[5] CALIBRATION (BR-04, O-4)
    │   temperature scaling fitted on frozen validation split (NLL minimisation)
    │   → calibrated confidence ∈ [0,1]
    ▼
[6] ABSTENTION GATE (BR-05) — the safety valve
    │   abstain if: no evidence ≥ floor │ confidence < 0.60 │ neighbour disagreement high
    │   abstain ⇒ "Unverified – Insufficient Evidence" + route to human queue
    ▼
[7] EXPLANATION GENERATOR (BR-06) — plain language: which claim, which evidence,
    │   why the verdict, confidence, and what would change it
    ▼
[8] SECONDARY SIGNALS (BR-07, BR-09)
    │   style: sensationalism / emotion / hedging / clickbait (display-only)
    │   source reliability score from TrustedSource registry
    │   time-sensitivity: temporal markers + evidence age ⇒ provisional flag
    ▼
 output: claims[] { verdict, calibratedConfidence, evidence[5], explanation,
                   styleSignals, provisional, highImpact, latencyMs, modelVersion }
```

**Anti-false-truth guarantees (user requirement “no false truth in model output”):**
- Verdict *requires* ≥1 evidence above floor — style alone can never convict (BR-07).
- Asymmetric threshold: to output `Contradicted`, the calibrated confidence must exceed a **higher bar (0.70)** than for `Supported (0.60)`. Missing a false story is recoverable; wrongly branding true content false is not (BRD §6.5).
- All confidences are temperature-scaled on held-out data; the model card reports ECE before/after.
- Neighbour disagreement acts as a third abstention trigger — a claim that matches evidence pointing in opposite directions is declared insufficient, not averaged.
- The engine is deterministic — same input ⇒ same output (auditability, BRD §6.6).

**Duplicate detection (BR-08):** Tier 1 queries `POST /v1/similar` with previously *human-reviewed* claims; if similarity ≥ 0.90 the existing human-verified verdict is reused (surfaced as “Reused prior human verdict”).

**Latency (NFR ≤10s p95):** TF-IDF retrieval over 12.8k docs is ~10–50 ms; total pipeline budget < 1 s. Per-request latency is measured and persisted for the ops dashboard.

---

## 5. Data Architecture

### 5.1 Knowledge Base (read-only, in ML tier)
- **Source:** LIAR dataset — 10,269 train / 1,284 validation / 1,283 test statements, each with: statement text, 6-way truthfulness rating (pants-fire → true), subjects, speaker, speaker job, state, party, historical lie counts, context.
- **Provenance:** `data/raw/PROVENANCE.md` records source, license, checksums, and the train/valid/test discipline: **validation is used for calibration fitting; the test split is frozen and never used for tuning** (BRD §9 golden-test-set principle). Release-gate metrics (§11 of BRD) are computed on the frozen test split and exposed via `GET /v1/eval`.
- **Trusted-source framing (BR-03):** every KB record is a published fact-check by PolitiFact — an allow-listed fact-check organisation. The TrustedSource registry in Tier 1 owns source metadata; only allow-listed sources are citable.

### 5.2 Operational Store (SQLite via Prisma, owned by Tier 1)

```
User(id, email, name, passwordHash, role[viewer|reviewer|senior_reviewer|admin])
TrustedSource(id, name, domain, category, reliabilityScore, approved, notes)
 ── 1:N ──▶ Evidence
Analysis(id, inputText, inputUrl, status[pending_review|in_review|reviewed|appealed],
         overallLabel, overallConfidence, highImpact, duplicateOfId, modelVersion,
         latencyMs, submittedById, createdAt)
 ── 1:N ──▶ Claim(id, position, text, claimType[factual|opinion|satire|prediction], assessable)
Claim ── 1:1 ──▶ Verdict(id, label, confidence, abstained, explanation, provisional,
                         evidenceAgeDays, styleSignalsJSON, sourceReliability, modelVersion)
Verdict ── 1:N ──▶ Evidence(id, rank, title, sourceId, url, excerpt, similarity, kbRating)
Verdict ── 1:N ──▶ Review(id, reviewerId, round[1|2], action[accept|edit|reject],
                          finalLabel, notes, createdAt)      ← BR-10..BR-12
Verdict ── 1:N ──▶ Appeal(id, appellantName, email, reason, status, resolverId,
                          resolutionNotes, createdAt, resolvedAt)   ← BR-14
Verdict ── 1:N ──▶ Feedback(id, reviewerId, agree, correctedLabel, notes)  ← BR-15
AuditLog(id, actorId, action, entityType, entityId, detailJSON, createdAt)  ← BR-13
```

Design notes:
- Verdicts are **per claim**; the Analysis carries a denormalised overall roll-up (risk-priority rule: any confident `Contradicted` claim dominates; else majority).
- Every mutation writes an `AuditLog` row (append-only) capturing actor, action, entity, and full decision context (input, model + data version, evidence, output, reviewer) — satisfying BR-13 traceability.
- Reviewer decisions are **final and override the model** (BR-11): `finalLabel` on the last review is authoritative everywhere in the UI.
- Retention/privacy (NFR): inputs are stored for review workflow only; no personal data beyond reviewer accounts; appeals store appellant contact only for resolution.

---

## 6. API Contracts

### 6.1 Tier 2 — ML Engine (FastAPI, `:8001`)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness |
| POST | `/v1/analyze` | full pipeline: `{text, url?, topK?}` → claims+verdicts+evidence+explanations+signals |
| POST | `/v1/similar` | near-duplicate lookup against reviewed-claim corpus |
| GET | `/v1/meta` | model card: version, thresholds, calibration report, KB stats |
| GET | `/v1/eval` | frozen-test-set gate metrics (macro-F1, abstention rate, ECE, verdict precision) |

### 6.2 Tier 1 — Application API (Next.js route handlers, `/api/*`)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/[...nextauth]` | public | credentials sign-in (sessions) |
| POST | `/api/analyze` | user | sanitise → rate-limit → dedup → ML call → persist+audit (BR-01..09) |
| GET | `/api/analyses` | user | list/filter queue (status, verdict, search, pagination) |
| GET | `/api/analyses/[id]` | user | full dossier incl. claims, evidence, reviews, appeals |
| POST | `/api/reviews` | reviewer | accept/edit/reject (BR-11); senior gate for round 2 (BR-12) |
| POST | `/api/appeals` | public | file appeal (BR-14) |
| GET | `/api/appeals` | user | list appeals w/ resolution SLA |
| PATCH | `/api/appeals/[id]` | senior/admin | resolve appeal |
| GET | `/api/analytics` | user | volume, verdict mix, abstention rate, override rate, latency p50/p95, fairness by topic (BR-16/17) |
| GET | `/api/audit` | user | filterable audit trail (BR-13) |
| GET/POST | `/api/sources` | user/admin | trusted-source registry |
| POST | `/api/feedback` | reviewer | reviewer feedback as labelled data (BR-15) |
| GET | `/api/model-card` | user | proxies `/v1/meta` + `/v1/eval` gate table |

**Cross-cutting API middleware (Tier 1):** zod body validation; in-memory token-bucket rate limiter (per IP+route); input sanitisation (length caps, control-char stripping, injection-pattern flagging); every handler wraps failures into structured errors — on ML-tier timeout/error the analyse route **degrades to “Unverified”** and still files a pending human review (fail-safe, BRD §6.8).

---

## 7. Application & Interaction Design (Tier 1 UI)

Single-route application shell (`/`), Cursor-IDE-inspired dark interface (per supplied reference):
- **Left sidebar (260px):** brand mark, primary nav (Home/Analyze, Review Queue, Analytics, Appeals, Audit Log, Sources, Model Card), recent analyses list, signed-in reviewer profile.
- **Home (Cursor-style):** contextual greeting, a prominent central composer card (“Paste a news article, headline or claim…”), mode selector (headline / article / URL), four suggestion chips (sample claims from the KB to try), disclaimer strip (“Assisted by automation — confirmed by humans”, BRD §10).
- **Analysis view (evidence-first anti-automation-bias, BRD §12):** input echo → extracted claims → per-claim verdict card: **evidence list rendered above the model verdict**, calibrated confidence gauge with the abstention band visible, plain-language explanation, style-signal chips clearly marked *“secondary indicator — never used to determine the verdict”*, source reliability, provisional/time flags, duplicate-reuse banner, and reviewer actions.
- **Review queue:** filters (status, impact, verdict); evidence-first cards; accept / edit / reject with mandatory notes on reject; **second-review lane** for high-impact (public figures, elections, health, safety) with senior-reviewer gating.
- **Analytics:** KPI tiles (median triage time proxy, abstention rate, override rate, p95 latency, verdict mix), 7-day volume trend, fairness-by-topic breakdown (BR-16/17).
- **Appeals:** file/open/resolved states with resolution-time tracking (BR-14).
- **Audit log:** append-only, filterable table (BR-13).
- **Sources:** allow-listed registry with reliability scores and change notes (BR-03, BR-07).
- **Model card:** version, thresholds, calibration report, release-gate table computed live on the frozen test set (BRD §11) — the “no false truth” transparency surface.

**Design system:** dark-only (Cursor reference) zinc-scale surfaces; emerald primary + amber highlight accents (no purple/blue/gradient-purple per requirements); Geist Sans/Mono; shadcn/ui primitives; WCAG-conscious contrast and keyboard navigation; responsive from 360 px (sidebar collapses to a sheet) with a fixed footer.

---

## 8. Security & Non-Functional Mapping

| NFR (BRD §8) | Implementation |
| --- | --- |
| Latency ≤10s p95 | TF-IDF retrieval; per-request latency persisted & charted |
| Availability / fail-safe | ML-tier outage ⇒ structured “Unverified” downgrade + human queue; health endpoint |
| Security | NextAuth sessions, bcrypt-hashed credentials, RBAC middleware on all mutating routes, zod validation everywhere, no client-side SDK exposure |
| Abuse resistance | per-IP token-bucket rate limit; prompt-injection pattern scan (flags + sanitises); evidence-source allow-listing (TrustedSource registry); input length caps |
| Privacy | data minimisation (no tracking, no PII beyond reviewer accounts + appellant contact) |
| Explainability | every verdict carries evidence citations + plain-language explanation + model/data version |
| Maintainability | stamped `modelVersion`; deterministic engine ⇒ one-click rollback = pin previous version; versioned thresholds in model card |
| Accessibility | semantic landmarks, aria labelling, keyboard navigable, 44px touch targets, non-colour verdict badges (icon + text) |

---

## 9. Failure Modes & Degradation

| Failure | Behaviour (fail-safe, BRD §6.8) |
| --- | --- |
| ML tier down / timeout | Analyse returns `Unverified – Insufficient Evidence`, analysis filed as pending human review, error never surfaced as a confident verdict |
| Malformed / adversarial input | zod + sanitiser reject or flag; injection-like text is stripped and logged to audit |
| Calibration drift | drift signals from analytics (abstention/override rate spikes) trigger manual re-eval via `/v1/eval` gate table |
| Duplicate submission | near-duplicate detection returns the existing human-verified verdict instead of re-guessing |
| Reviewer disagreement | final decision = last authorised review; all rounds kept in audit trail |

---

## 10. Deployment Topology (this sandbox)

| Component | Command | Port |
| --- | --- | --- |
| Gateway (Caddy) | pre-configured | 81 (external) |
| Next.js app | `bun run dev` (repo root) | 3000 |
| ML engine | `bun run dev` in `mini-services/nlp-engine` → `uvicorn --reload` | 8001 |
| Database | SQLite file `db/custom.db` via Prisma | — |

The browser only ever addresses same-origin relative URLs; Caddy routes `/`→3000 and `?XTransformPort=8001`→ML tier (used only for direct debugging, never by the app UI).

---

## 11. BRD Coverage Traceability Matrix

| BRD ID | Where implemented |
| --- | --- |
| BR-01 claim extraction | ML `/v1/analyze` step 2 |
| BR-02 opinion/satire/prediction ⇒ not assessable | claim classifier step 2 |
| BR-03 evidence retrieval + citation + allow-list | retrieval step 3, TrustedSource registry, evidence UI |
| BR-04 graded verdict + calibrated confidence | steps 4–5, temperature scaling |
| BR-05 abstention below threshold | step 6 gate + asymmetric thresholds |
| BR-06 plain-language explanation | step 7 generator |
| BR-07 style/reliability = secondary only | step 8 display-only signals |
| BR-08 duplicate reuse | `/v1/similar` + reuse banner |
| BR-09 time-sensitivity/provisional | step 8 temporal flags |
| BR-10 reviewer dashboard | Analysis + Review Queue views |
| BR-11 accept/edit/reject override | `/api/reviews`, finalLabel authoritative |
| BR-12 second review high-impact | highImpact flag + senior round-2 gate |
| BR-13 audit trail | AuditLog on every mutation + Audit view |
| BR-14 appeals workflow | Appeal model + views + SLA tracking |
| BR-15 reviewer feedback | Feedback model + `/api/feedback` |
| BR-16 ops dashboards | `/api/analytics` + Analytics view |
| BR-17 fairness reports | analytics by topic/source-type |
| §6.1 no binary verdict | taxonomy everywhere |
| §6.8 fail-safe | degradation matrix (§9) |
| §11 release gates | `/v1/eval` + Model Card view |
| §10 disclosure | disclaimer surfaces (Home, Analysis, Model Card) |

**Verdict: architecture covers every in-scope BRD requirement → approved for build.**

