# Dataset Provenance Record

## LIAR Dataset (PolitiFact)

| Field | Value |
| --- | --- |
| Corpus | LIAR — benchmark dataset for fake news detection (Wang, 2017: “Liar, Liar Pants on Fire: A New Benchmark Dataset for Fake News Detection”) |
| Original source | https://pages.ucsb.edu/~william/wang/data/liar_dataset.zip |
| Mirror actually used | https://github.com/tfs4/liar_dataset (raw.githubusercontent.com) — UCSB site unreachable from this environment |
| Statements | 12,836 short political statements from PolitiFact.com |
| Labels (6-way, graded) | pants-fire, false, barely-true, half-true, mostly-true, true |
| Extra metadata | subjects, speaker, speaker job title, state, party, historical lie counts, context (venue) |
| License | CC BY 4.0 (attributed per source repo; research/demo use) |
| Downloaded | 2026-09-30 |

## Files & checksums (MD5)

| File | Lines | MD5 |
| --- | --- | --- |
| train.tsv | 10,269 | 394cd917733276391ceac6ac7542ebe0 |
| valid.tsv | 1,284 | 735058b28189e774d7a7a12334cb8219 |
| test.tsv | 1,283 | 41e0cf170bbb85bb15eb6d3267c9cd22 |

## Data discipline (BRD §9 — golden test set)

- `valid.tsv` is used ONLY to fit the confidence calibrator (temperature scaling).
- `test.tsv` is **frozen**: never used for training or threshold tuning. Release-gate
  metrics (macro-F1, abstention rate, ECE, verdict precision) are computed on it
  via `GET /v1/eval` of the NLP engine.
- The retrieval knowledge base is built from `train.tsv` (+ validation for
  calibration); test records are excluded from retrieval to avoid leakage.

## Label → Verdict taxonomy mapping

| LIAR rating | Veritas taxonomy |
| --- | --- |
| true | Supported |
| mostly-true | Supported |
| half-true | Misleading / Missing Context |
| barely-true | Misleading / Missing Context |
| false | Contradicted |
| pants-fire | Contradicted |

## Known limitations (documented per BRD §10 — plain-language disclosure)

- Corpus is US-politics-centric; fairness gaps by region are expected and surfaced
  in the analytics fairness report rather than hidden.
- Statements are short claims, not full articles; long inputs are decomposed into
  claims before retrieval.
- PolitiFact ratings themselves are human editorial judgments; Veritas reuses them
  as trusted evidence, it does not re-adjudicate them.
