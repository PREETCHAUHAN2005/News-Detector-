<div align="center">

<img src="docs/veritas-logo.svg" alt="Veritas logo — a shield with a checkmark" width="72" height="72" />

# Veritas

### NLP Fact-Checking Workbench — decision support for humans, not an automated judge

**Evidence-first fake-news detection with graded verdicts, calibrated confidence, and a mandatory human in the loop.**

[![Next.js 16](https://img.shields.io/badge/Next.js%2016-App%20Router-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.12x-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.5-F7931E?style=flat-square&logo=scikitlearn&logoColor=white)](https://scikit-learn.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![License: Research use](https://img.shields.io/badge/Data-LIAR%20·%20CC%20BY%204.0-10B981?style=flat-square)](data/raw/PROVENANCE.md)

</div>

---

> ### ⚖️ The core design rule
> **Missing a false story is recoverable — wrongly branding true content as false is not.**
> Every technical decision below (asymmetric thresholds, abstention gate, evidence-first UI, human sign-off) exists to enforce that asymmetry.

---

## 📸 The Workbench

<p align="center">
  <img src="docs/screenshots/01-home-workbench.png" alt="Veritas home — the analyze composer with claim suggestions, recents and keyboard-first navigation" width="920" />
</p>

<p align="center"><sub><b>Home.</b> Paste a claim, headline or article — or pick a known fact-check. No login screen: the app opens straight into a demo reviewer session.</sub></p>

<br />

<p align="center">
  <img src="docs/screenshots/02-analysis-dossier.png" alt="Analysis dossier — Contradicted verdict at 93% calibrated confidence with five cited PolitiFact evidence rows rendered above the model recommendation" width="920" />
</p>

<p align="center"><sub><b>Analysis dossier.</b> Evidence is rendered <i>before</i> the model recommendation (anti-automation-bias). This near-duplicate hit the BR-08 reuse gate — the published <b>human</b> verdict is reused instead of re-guessing.</sub></p>

<br />

<p align="center">
  <img src="docs/screenshots/12-mobile-home.png" alt="Veritas on mobile — 390px viewport, fully responsive" width="300" />
  <img src="docs/screenshots/13-mobile-nav.png" alt="Mobile navigation drawer" width="300" />
</p>

<p align="center"><sub><b>Responsive from 360 px.</b> Sidebar collapses into a sheet; verdict cards stack. No horizontal overflow, footer pinned.</sub></p>

---

## 📑 Table of Contents

- [Why Veritas exists](#-why-veritas-exists)
- [The four non-negotiable pillars](#-the-four-non-negotiable-pillars)
- [Features](#-features)
- [How a claim gets verified](#-how-a-claim-gets-verified)
- [Architecture](#-architecture)
- [Tech stack](#-tech-stack)
- [Quick start](#-quick-start)
- [Configuration](#-configuration)
- [API reference](#-api-reference)
- [Data & provenance](#-data--provenance)
- [Safety properties](#-safety-properties-baked-into-every-verdict)
- [Security hardening](#-security-hardening)
- [Honest limitations](#-honest-limitations)
- [Project structure](#-project-structure)
- [Credits](#-credits)

---

## 🧭 Why Veritas exists

Binary "fake / real" classifiers are the wrong tool for fact-checking. Real verification work needs:

- **Grades of truth** — a half-true statement is not "fake news", and satire is not assessable at all.
- **Citations** — a verdict without retrievable evidence is just another opinion.
- **Humility** — when the system is unsure, the correct output is *"I don't know"*, not a coin-flip label.
- **Accountability** — a human reviewer owns every published verdict; the model only recommends.

Veritas is a full-stack implementation of that philosophy, backed by **12,836 human-fact-checked statements** from the LIAR corpus (PolitiFact) — a free, public, graded benchmark.

---

## 🏛 The four non-negotiable pillars

| Pillar | What it means in code |
| --- | --- |
| **1 · Graded taxonomy** | Verdicts are `Supported` · `Contradicted` · `Misleading / Missing Context` · `Unverified – Insufficient Evidence` · `Opinion/Satire (not assessable)`. Binary fake/real output does not exist anywhere in the system. |
| **2 · Evidence-first** | A verdict **requires ≥ 1 retrieved citation above the similarity floor**. Style signals (sensationalism, emotion, clickbait) are rendered in the UI as *display-only* and can never flip a verdict. |
| **3 · Abstain by default** | Below the calibrated confidence bar (0.60 / 0.70 asymmetric), or with high neighbour disagreement, the engine returns *Unverified* and routes the claim to the human queue. |
| **4 · Human-in-the-loop** | Reviewers accept / edit / reject every recommendation (their decision is final and overrides the model). High-impact claims need a senior second sign-off. Everything is audit-logged and appealable. |

---

## ✨ Features

### 1 · Analyze — claim extraction & verification

Paste a claim, headline, or a whole article. The engine segments it into checkable claims (factual / opinion / satire / prediction), retrieves evidence for each, and recommends a graded verdict with a calibrated confidence gauge.

<p align="center">
  <img src="docs/screenshots/02-analysis-dossier.png" alt="Dossier: verdict header, confidence gauge, evidence list, model recommendation, reviewer decision panel, precedent panel" width="880" />
</p>

Each per-claim dossier section includes:
- **Retrieved evidence** — top-5 PolitiFact rulings with match %, idf-ranked highlight terms that *explain why* this evidence was retrieved, speaker, context, and source reliability from the trusted-source registry.
- **Model recommendation** — placed *after* the evidence (anti-automation-bias, BRD §12).
- **Plain-language "Why"** — which claim, which evidence, what would change the verdict.
- **Secondary signals** — style chips explicitly marked *never used to determine the verdict*.
- **Precedent panel** — how near-identical claims were ruled by humans before (advisory only).

### 2 · Review queue — the human is the judge

<p align="center">
  <img src="docs/screenshots/03-review-queue.png" alt="Review queue — filterable evidence-first triage list with high-impact lane" width="880" />
</p>

Keyboard-driven triage (`j`/`k` to select, `↵` to open): status/verdict/impact filters, evidence-first cards, accept / edit-label / reject-to-Unverified with mandatory notes, BR-08 reuse badges, and a second-review lane for high-impact claims gated to senior reviewers.

### 3 · Operations analytics & fairness

<p align="center">
  <img src="docs/screenshots/04-analytics.png" alt="Analytics KPI tiles with sparklines" width="880" />
</p>

<p align="center">
  <img src="docs/screenshots/05-analytics-charts.png" alt="Verdict mix donut, daily volume, review actions and fairness-by-topic charts" width="880" />
</p>

KPI tiles (analyses, reviews, appeals, abstention rate, override rate, latency p95) each with **sparklines and period deltas**; verdict-mix donut; daily volume with Contradicted overlay; review-action breakdown; and **fairness by topic (BR-17)** — subgroup gaps are surfaced, not hidden. One-click **CSV export**.

### 4 · Appeals — verdicts are contestable

<p align="center">
  <img src="docs/screenshots/06-appeals.png" alt="Appeals view — open and resolved appeals with resolution notes" width="880" />
</p>

Anyone can file an appeal against a published verdict; senior reviewers/admins resolve with upheld/overturned decisions and notes, tracked with resolution times (BR-14).

### 5 · Append-only audit log

<p align="center">
  <img src="docs/screenshots/07-audit-log.png" alt="Audit log — filterable append-only trail of every mutation" width="880" />
</p>

Every mutation (analysis created, review submitted, appeal filed/resolved, feedback recorded, source updated, dedup reused, engine degraded) writes an immutable AuditLog row (BR-13).

### 6 · Trusted-source registry

<p align="center">
  <img src="docs/screenshots/08-sources.png" alt="Trusted sources — allow-listed domains with reliability scores" width="880" />
</p>

Only allow-listed sources are citable. Admins can tune reliability scores; every change is audited (BR-03).

### 7 · Model card & release gates

<p align="center">
  <img src="docs/screenshots/09-model-card.png" alt="Model card — methodology, thresholds, corpus stats, safety properties, release gates" width="880" />
</p>

Live-computed on the **frozen test split**: macro-F1, abstention rate, ECE (calibration error), verdict precision vs. the BRD release gates. The system ships in **shadow mode** because the gates honestly fail — see [Honest limitations](#-honest-limitations).

### 8 · Precedent search — "has this been ruled on before?"

<p align="center">
  <img src="docs/screenshots/11-precedent-search.png" alt="Precedent search dialog — per-claim similarity lookup against human-ruled records" width="880" />
</p>

A pure lookup (nothing analyzed or stored): segments the input into claims and sweeps each against the 50 human-ruled records, grouped by claim. Advisory only — verdict reuse requires the stricter BR-08 near-duplicate gate.

### 9 · Keyboard-first UX

<p align="center">
  <img src="docs/screenshots/10-command-palette.png" alt="Command palette — navigation and recents" width="440" />
  <img src="docs/screenshots/14-shortcuts.png" alt="Keyboard shortcuts cheat sheet" width="440" />
</p>

`⌘K` command palette, `g`+`h/r/a/e/u/s/m` view navigation, `?` shortcuts cheat-sheet, `j`/`k` queue triage, `⌘↩` submit. Fully keyboard operable, WCAG-conscious contrast, 44 px touch targets.

---

## 🔬 How a claim gets verified

The engine is a **retrieval-augmented verification pipeline** — deterministic, auditable, no LLM-as-judge:

```
 input text
    │
    ▼
[1] SANITIZE — length caps, control-char stripping, prompt-injection scan (flag only)
    │
    ▼
[2] CLAIM EXTRACTION — sentence segmentation → factual | opinion | satire | prediction
    │                    non-factual ⇒ "not assessable"
    ▼
[3] EVIDENCE RETRIEVAL — TF-IDF dual-channel (word 1–2 gram 65% + char_wb 3–5 gram 35%)
    │                     cosine similarity vs 12.8k fact-checked statements
    │                     top-k = 5 · similarity floor = 0.12 · no evidence ⇒ forced abstain
    ▼
[4] VERDICT REASONING — neighbour vote weighted by sim² × source-trust prior
    │                     LIAR rating → graded taxonomy map
    ▼
[5] CALIBRATION — temperature scaling fitted on the frozen validation split
    │
    ▼
[6] ABSTENTION GATE — the safety valve
    │   abstain if: no evidence ≥ floor │ confidence < 0.60 │ neighbour disagreement high
    │   ⇒ "Unverified – Insufficient Evidence" + route to the human queue
    ▼
[7] EXPLANATION — plain language: which claim, which evidence, what would change it
    │
    ▼
[8] SECONDARY SIGNALS — style + source reliability + time-sensitivity (display-only)
```

**The anti-false-truth asymmetry:** to output `Contradicted`, calibrated confidence must clear a **0.70** bar — higher than the 0.60 required for `Supported`. Wrongly calling true content false is treated as the worst failure mode (BRD §6.5).

**Near-duplicate reuse (BR-08):** statements ≥ 0.90 similar to an already *human-reviewed* claim reuse the published human verdict — surfaced with a dedicated badge — instead of letting the model guess again.

---

## 🏗 Architecture

Two services behind one gateway — stateful TypeScript business logic, stateless Python ML:

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Browser  (Reviewer)                            │
│          single-page app shell — all views rendered client-side        │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ relative URLs (same-origin)
┌───────────────────────────────▼────────────────────────────────────────┐
│                      Caddy Gateway  (port 81)                          │
│         /                  →  Next.js App Router     (port 3000)       │
│         ?XTransformPort=8001 →  Python NLP Engine     (port 8001)      │
└───────────┬─────────────────────────────────────────┬──────────────────┘
            │                                         │
┌───────────▼──────────────────────┐    ┌─────────────▼──────────────────┐
│ TIER 1 — Application (TypeScript)│    │ TIER 2 — ML Engine (Python)    │
│ Next.js 16 App Router · :3000    │    │ FastAPI + scikit-learn · :8001 │
│ API routes: zod + rate limits    │───▶│ POST /v1/analyze               │
│ Sessions + RBAC (NextAuth)       │    │ POST /v1/segment               │
│ Persistence: Prisma + SQLite     │    │ POST /v1/similar  (BR-08)      │
│ Audit, reviews, appeals,         │    │ GET  /v1/meta  (model card)    │
│   analytics aggregation          │    │ GET  /v1/eval  (frozen gates)  │
│ Engine supervision (keep-alive)  │    │ GET  /healthz                  │
└───────────┬──────────────────────┘    └─────────────┬──────────────────┘
            │                                         │
┌───────────▼──────────────────────┐    ┌─────────────▼──────────────────┐
│ SQLite via Prisma                │    │ Knowledge Base (read-only)     │
│ Users, Analyses, Claims,         │    │ LIAR corpus (PolitiFact)       │
│ Verdicts, Evidence, Reviews,     │    │ 12,836 graded statements       │
│ Appeals, Feedback, AuditLogs,    │    │ test split frozen — no         │
│ TrustedSources                   │    │   leakage into retrieval       │
└──────────────────────────────────┘    └────────────────────────────────┘
```

- The browser **never** calls the ML tier directly — all ML calls happen server-side from Next.js API routes, which keeps the rate-limit/auth boundary in one place.
- The ML engine is **stateless and deterministic** — same input ⇒ same output; it can be restarted or rolled back (`modelVersion` stamped on every verdict) with no data loss.
- The Next.js process **supervises the engine**: a health heartbeat auto-spawns and keeps the Python service alive (`ensureEngine()` in `src/lib/nlp-client.ts`).

Full design document with the complete BRD traceability matrix (BR-01 … BR-17): [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 🧰 Tech stack

| Layer | Technology | Why |
| --- | --- | --- |
| UI + business tier | **Next.js 16** (App Router) + **TypeScript 5** | Types end-to-end, single `/` route app shell |
| UI components | **shadcn/ui** + **Tailwind CSS 4** + Radix primitives | Accessible, consistent dark design system |
| Charts | **Recharts** | Analytics dashboards with sparklines & donuts |
| Client state | **Zustand** · **TanStack Query** | View state / server state |
| Auth | **NextAuth v4** (credentials + RBAC) | Sessions, role gates (currently bypassed for demo — see [Configuration](#-configuration)) |
| ORM / store | **Prisma 6** + **SQLite** | Typed persistence, cascade deletes, audit-friendly |
| ML tier | **Python 3.12 + FastAPI** | Async, pydantic-validated contracts |
| ML libraries | **scikit-learn + NumPy** | Deterministic, auditable, no deep-learning black box |
| Data | **LIAR corpus** (PolitiFact, UCSB) | Free public benchmark with **graded** 6-way labels — matches the taxonomy |

**Deliberately avoided:** LLM-as-judge (non-deterministic, unverifiable), deep-learning stacks (unauditable for v1), binary classifiers (violates graded taxonomy).

---

## 🚀 Quick start

### Prerequisites

- **Bun** ≥ 1.1 (runs the Next.js app and scripts)
- **Python** ≥ 3.12 with `pip` (the NLP engine)
- Nothing else — SQLite is file-based, the dataset is vendored in `data/raw/`

### Bring it up (two terminals, ~2 minutes)

**Terminal 1 — NLP engine (port 8001):**

```bash
cd mini-services/nlp-engine
pip install -r requirements.txt
bun run dev          # = uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

**Terminal 2 — application:**

```bash
# install JS dependencies
bun install

# create the SQLite schema
bun run db:push

# seed demo users, the trusted-source registry and sample reviewed claims
# (needs the engine from terminal 1 up on :8001)
bun run scripts/seed.ts

# start the app → http://localhost:3000
bun run dev
```

> **Tip:** after the initial seed, terminal 1 is technically optional — the Next.js process auto-spawns and supervises the engine via a health heartbeat (`ensureEngine()` in `src/lib/nlp-client.ts`). Keep the manual start only if you're hacking on the engine itself and want `--reload`.

Visit **http://localhost:3000** — the app opens **directly into the workbench** with an automatic demo reviewer session (no login screen; see [Configuration](#-configuration) to bring auth back).

Paste any political claim, or click one of the **"Try a known fact-check"** cards to exercise the evidence-retrieval and BR-08 reuse paths end-to-end.

<details>
<summary><b>Seeded demo accounts</b> (for when the login screen is re-enabled)</summary>

| Email | Password | Role |
| --- | --- | --- |
| `reviewer@veritas.io` | `veritas123` | Reviewer (auto-session account) |
| `senior@veritas.io` | `veritas123` | Senior reviewer (round-2 gate, appeal resolution) |
| `admin@veritas.io` | `veritas123` | Admin (source registry) |
| `viewer@veritas.io` | `veritas123` | Viewer (read-only) |

</details>

---

## ⚙️ Configuration

### `.env`

```bash
DATABASE_URL="file:./db/custom.db"     # SQLite store
NEXTAUTH_URL="http://localhost:3000"   # app origin
NEXTAUTH_SECRET="<96-hex-char secret>" # REQUIRED in production (never commit)
```

### Login screen on/off — one flag

The workbench currently opens **without any login screen** (demo mode). To restore full authentication, flip a single constant in [`src/lib/auth-mode.ts`](src/lib/auth-mode.ts):

```ts
export const AUTH_LOGIN_ENABLED = false;   // → true brings back the sign-in screen
```

No other code changes are needed — the sign-in view, session gates, and all 401 responses come back automatically. BRD role gates (viewer / reviewer / senior_reviewer / admin) remain enforced in either mode.

---

## 🔌 API reference

### ML engine — FastAPI (`:8001`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness + model version + KB size |
| `POST` | `/v1/analyze` | Full pipeline: `{text, url?, topK?}` → claims, verdicts, evidence, explanations, signals |
| `POST` | `/v1/segment` | Claim extraction only (powers the composer's live claim count) |
| `POST` | `/v1/similar` | Near-duplicate lookup against human-reviewed claims (BR-08) |
| `GET` | `/v1/meta` | Model card: version, thresholds, calibration report, KB stats |
| `GET` | `/v1/eval` | Frozen-test-set gate metrics (macro-F1, abstention, ECE, verdict precision) |

### Application API — Next.js route handlers (`/api/*`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | Sanitise → rate-limit → dedup → ML call → persist + audit |
| `GET` | `/api/analyses` | Queue list: status/verdict/search filters, pagination |
| `GET` | `/api/analyses/[id]` | Full dossier: claims, evidence, reviews, appeals |
| `GET` | `/api/analyses/[id]/similar` | Similar reviewed analyses |
| `POST` | `/api/segment` | Claim segmentation (composer hint) |
| `POST` | `/api/precedents` | Per-claim precedent sweep |
| `POST` | `/api/reviews` | Accept / edit / reject (BR-11, senior round-2 gate BR-12) |
| `POST` | `/api/appeals` · `GET` | File appeal (BR-14) · list with SLA |
| `PATCH` | `/api/appeals/[id]` | Resolve appeal (senior/admin) |
| `POST` | `/api/feedback` | Reviewer feedback as labelled data (BR-15) |
| `GET` | `/api/analytics` | Volume, verdict mix, abstention, overrides, latency, fairness (BR-16/17) |
| `GET` | `/api/audit` | Filterable audit trail (BR-13) |
| `GET` · `POST` | `/api/sources` | Trusted-source registry |
| `GET` | `/api/model-card` | Proxies `/v1/meta` + live release-gate table |
| `GET` | `/api/health` | App + engine health (also the engine keep-alive heartbeat) |

Cross-cutting on every route: **zod body validation**, per-IP token-bucket **rate limiting**, input sanitisation (length caps, control-char stripping, injection-pattern flagging), and structured fail-safe errors — an engine timeout degrades the analysis to *Unverified* and still files a human review (BRD §6.8).

---

## 📚 Data & provenance

| | |
| --- | --- |
| Corpus | **LIAR** — 12,836 short political statements, each with a **6-way graded rating**, speaker, context and venue (Wang, 2017, *"Liar, Liar Pants on Fire"*) |
| Splits | train 10,269 · validation 1,284 · test 1,283 |
| License | CC BY 4.0 — research/demo use, fully attributed |
| Record | [`data/raw/PROVENANCE.md`](data/raw/PROVENANCE.md) — source, mirror, MD5 checksums, discipline |

**Data discipline:** the validation split is used *only* to fit the confidence calibrator (temperature scaling); the **test split is frozen** — never used for training or threshold tuning — and release-gate metrics are computed on it via `GET /v1/eval`. Test records are excluded from the retrieval KB to avoid leakage.

**Label → taxonomy mapping:**

| LIAR rating | Veritas verdict |
| --- | --- |
| `true`, `mostly-true` | Supported |
| `half-true`, `barely-true` | Misleading / Missing Context |
| `false`, `pants-fire` | Contradicted |

---

## 🛡 Safety properties (baked into every verdict)

- **Graded taxonomy only** — no binary fake/real output exists in the system.
- **No evidence, no verdict** — retrieval must clear the similarity floor; style alone can never convict.
- **Asymmetric thresholds** — 0.70 bar for `Contradicted` vs 0.60 for `Supported` minimises wrongly labelling true content false.
- **Abstention gate** — low confidence or contradictory evidence ⇒ *Unverified* + human queue, never a guess.
- **Deterministic engine** — same input, same output (auditability); `modelVersion` + `dataVersion` stamped on every verdict.
- **Calibrated confidence** — temperature-scaled on held-out data; ECE reported before/after in the model card.
- **Human decisions are final** — `finalLabel` from the last authorised review is authoritative everywhere in the UI (BR-11).
- **Fail-safe degradation** — engine outage ⇒ *Unverified* + pending human review; errors are never surfaced as confident verdicts.

---

## 🔒 Security hardening

The codebase has passed a full security inspection. Notable measures:

- **Secrets**: generated `NEXTAUTH_SECRET` (no dev fallback in production paths), `.env` untracked.
- **Headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` on all responses.
- **Injection**: CSV-formula injection neutralised in exports (OWASP quote-prefix); Prisma parameterised queries only — no raw SQL; no `dangerouslySetInnerHTML` / `eval`; ReDoS-safe highlight regexes.
- **Auth**: scrypt password hashing with `timingSafeEqual`; SameSite=Lax sessions; zod validation on every POST body.
- **Abuse**: per-IP token-bucket rate limits on all mutating routes; input length caps; prompt-injection pattern scanning (flag + strip).
- **Dependencies**: next-auth and prisma patched to current; remaining audit findings are dev-toolchain-only.
- **ML tier**: bound to localhost only; exception strings sanitised out of API responses.

---

## 🧯 Honest limitations

This project treats honesty as a feature — the **model card shows release gates currently failing** (macro-F1 ≈ 0.70 vs the 0.85 gate), so the system runs in **shadow mode by design** (BRD §14): recommendations only, humans decide.

Other known limits:

- Retrieval is TF-IDF lexical similarity — paraphrases that share little vocabulary can fall below the floor and (correctly) abstain.
- The knowledge base is US-politics-centric (PolitiFact); out-of-domain claims will mostly abstain rather than guess. **This is intended.**
- Phase 4 (not built): i18n, live web retrieval for fresh evidence.
- Demo mode (login disabled) treats cookieless API callers as the demo reviewer — flip `AUTH_LOGIN_ENABLED` to `true` for any multi-user deployment.

---

## 🗂 Project structure

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                  # single-route app shell (SessionGate + VeritasApp)
│   │   ├── layout.tsx                # root layout, theme, toaster
│   │   └── api/                      # 16 route groups (see API reference)
│   ├── components/
│   │   ├── views/                    # home, analysis, review, analytics,
│   │   │                             # appeals, audit, sources, model-card, signin
│   │   ├── verdict/                  # evidence-list, confidence-gauge, verdict-badge,
│   │   │                             # style-signals, precedent-row
│   │   ├── app-sidebar.tsx           # nav + recents
│   │   ├── app-topbar.tsx            # identity, engine/DB status, palette trigger
│   │   ├── command-palette.tsx       # ⌘K
│   │   ├── precedent-search-dialog.tsx
│   │   └── ui/                       # shadcn/ui primitives
│   ├── lib/                          # auth, db, nlp-client (engine supervision),
│   │                                 # rate-limit, audit, csv, api, store (zustand)
│   └── hooks/
├── mini-services/
│   └── nlp-engine/                   # FastAPI ML engine (port 8001)
│       └── app/
│           ├── main.py               # endpoints
│           ├── engine.py             # retrieval + verdict reasoning
│           ├── calibration.py        # temperature scaling
│           ├── claims.py             # claim extraction
│           ├── taxonomy.py          # graded label map
│           ├── style.py              # secondary signals
│           └── data.py               # LIAR corpus loading
├── prisma/schema.prisma              # 9-model operational schema
├── data/raw/                         # LIAR train/valid/test + provenance
├── scripts/                          # seed, dev-up, engine-watchdog, backfill-history
├── docs/qa/                          # 19 rounds of QA screenshots
├── docs/screenshots/                 # curated README screenshots
├── ARCHITECTURE.md                   # full design doc + BRD traceability
└── worklog.md                        # development handover log
```

---

## 🙏 Credits

- **[LIAR dataset](https://pages.ucsb.edu/~william/wang/liar_dataset)** — William Wang, UCSB (2017), *“Liar, Liar Pants on Fire: A New Benchmark Dataset for Fake News Detection”* — CC BY 4.0.
- **[PolitiFact](https://www.politifact.com/)** — the underlying human fact-checks.
- Built with [Next.js](https://nextjs.org/), [FastAPI](https://fastapi.tiangolo.com/), [scikit-learn](https://scikit-learn.org/), [Prisma](https://www.prisma.io/), [shadcn/ui](https://ui.shadcn.com/) and [Recharts](https://recharts.org/).

---

<div align="center">

**Veritas never labels content automatically — a reviewer confirms every verdict.**

</div>
