# Business Requirements Document (BRD)

## Fake News Detection using Natural Language Processing

| Field | Value |
| --- | --- |
| Document version | 1.0 (Draft for stakeholder review) |
| Date | 30 September 2026 |
| Status | Pending sign-off |
| Classification | Internal |

---

## 1. Purpose

This document defines the business requirements for a system that analyses news content using NLP and helps people judge whether a claim is credible. It states **what** the business needs and the **safety constraints** the solution must respect. It does not prescribe implementation.

## 2. Business Problem

Misinformation spreads faster than manual fact-checking can respond. Reviewers are overloaded, response times are slow, and inconsistent judgments erode trust. At the same time, wrongly labelling true news as "fake" causes reputational, legal and free-expression harm, and is arguably worse than missing a false story.

**Core design position:** the system is a **decision-support tool**, not an automated judge. Because a wrong verdict has real consequences, every requirement below favours caution, transparency and human oversight over raw automation.

## 3. Objectives and Success Metrics

| ID | Objective | Measure (targets to be validated on the golden test set, §11) |
| --- | --- | --- |
| O-1 | Reduce time to triage a suspect claim | Median triage time reduced by at least 60% vs. manual baseline |
| O-2 | Keep wrong "false" verdicts very rare | False-positive rate on true content ≤ 2% for any output shown as "Likely False" |
| O-3 | Give reviewers evidence, not just a label | 100% of non-abstained verdicts carry cited sources and an explanation |
| O-4 | Be honest about uncertainty | Confidence scores calibrated (expected calibration error ≤ 0.05) |
| O-5 | Keep humans in control | 100% of high-impact outputs pass human review before publication or action |

## 4. Scope

**In scope**

- Ingest news articles, headlines and short claims (text, with URL metadata).
- NLP-based credibility analysis: claim extraction, evidence retrieval, claim-vs-evidence verification, source-reliability signals, and stylistic/manipulation cues as *supporting* signals only.
- Reviewer dashboard with evidence, explanation, confidence and override.
- Audit logging, feedback capture, monitoring.
- Languages: English at launch; additional languages only after separate evaluation (§Phase 3).

**Out of scope (v1)**

- Automatic removal, blocking, demonetisation or public labelling of content.
- Image, audio and video deepfake detection.
- Detection of individual users or "fake accounts".
- Judging opinion, satire or predictions as true/false.
- Real-time detection of breaking news with no available evidence.

## 5. Stakeholders

| Stakeholder | Interest |
| --- | --- |
| Business owner / sponsor | Outcomes, risk, cost |
| Fact-check / editorial reviewers | Primary users; final authority on verdicts |
| End readers (if outputs are published) | Trustworthy, understandable labels |
| Legal and compliance | Defamation, privacy and regulatory exposure |
| Data science / engineering | Feasibility, quality, maintainability |
| Security / IT | Abuse resistance, data protection |
| Trust and safety / ethics lead | Bias, harm, appeals |

## 6. Safety Principles (Non-Negotiable)

1. **No binary "fake/real" verdict.** Outputs use a graded taxonomy: *Supported*, *Contradicted*, *Misleading / Missing Context*, *Unverified – Insufficient Evidence*, *Opinion / Satire (not assessable)*.
2. **Abstain by default when unsure.** Below a confidence threshold the system returns "Insufficient Evidence" instead of guessing.
3. **Evidence-first.** No verdict without retrieved, cited sources. Style or writing tone alone must never produce a "false" verdict.
4. **Human-in-the-loop.** The system recommends; a trained reviewer decides. No automated punitive action.
5. **Asymmetric error cost.** Thresholds are tuned to minimise wrongly labelling true content as false, even at the cost of lower recall.
6. **Explainable and auditable.** Every decision is traceable to input, model version, evidence and reviewer action.
7. **Appeal and correction.** Any labelled party can request review; corrections are logged and fed back.
8. **Fail safe.** On error, timeout or drift alert, the system degrades to "Unverified" and routes to a human, never to a confident verdict.

## 7. Business Requirements

Priority: **M** = Must, **S** = Should, **C** = Could.

### 7.1 Analysis and Verdicts

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-01 | Accept text input (headline, body, URL) and extract discrete, checkable claims. | M |
| BR-02 | Distinguish factual claims from opinion, satire and predictions, and mark the latter "Not assessable". | M |
| BR-03 | Retrieve evidence from an approved list of trusted sources (fact-check organisations, official records, reputable wire services) and cite it. | M |
| BR-04 | Produce a verdict from the graded taxonomy (§6.1) with a calibrated confidence score. | M |
| BR-05 | Return "Insufficient Evidence" below the confidence threshold instead of a verdict. | M |
| BR-06 | Provide a plain-language explanation showing which claim, which evidence and why. | M |
| BR-07 | Use source-reliability and writing-style signals only as secondary indicators, never as sole basis. | M |
| BR-08 | Detect near-duplicate or previously reviewed claims and reuse the existing human-verified verdict. | S |
| BR-09 | Handle time-sensitive claims by flagging evidence age and marking fast-changing stories as provisional. | S |

### 7.2 Human Review and Governance

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-10 | Reviewer dashboard showing input, extracted claims, evidence, confidence and model recommendation. | M |
| BR-11 | Reviewer can accept, edit or reject any recommendation; reviewer decision is final and overrides the model. | M |
| BR-12 | Mandatory second review for high-impact cases (public figures, elections, health, safety, or anything to be published). | M |
| BR-13 | Full audit trail: input, model and data version, evidence, output, reviewer, timestamps. | M |
| BR-14 | Appeal and correction workflow with tracked resolution time. | M |
| BR-15 | Reviewer feedback captured as labelled data for retraining, subject to quality checks. | S |

### 7.3 Reporting

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-16 | Dashboards for volume, verdict mix, abstention rate, override rate, latency and error rates. | S |
| BR-17 | Fairness reports by topic, language, region and source type. | S |

## 8. Non-Functional Requirements

| Area | Requirement |
| --- | --- |
| Accuracy and calibration | Meet acceptance thresholds in §11 before each release. |
| Latency | Triage result within 10 seconds for a single article (p95). |
| Availability | 99.5% for the reviewer tool; model outage must fall back to manual workflow. |
| Security | Role-based access, encryption in transit and at rest, secrets management, penetration test before go-live. |
| Abuse resistance | Rate limiting, protection against prompt injection and adversarial text manipulation, evidence-source allow-listing. |
| Privacy | Data minimisation; no personal data stored beyond what review requires; retention limits defined. |
| Explainability | Every output traceable and understandable by a non-technical reviewer. |
| Maintainability | Versioned models, data and thresholds; one-click rollback. |
| Accessibility | Reviewer UI meets WCAG 2.1 AA. |

## 9. Data Requirements

- **Training and evaluation data:** licensed, documented datasets plus in-house reviewer-labelled data. Each dataset needs a provenance record and licence check.
- **Label quality:** at least two independent annotators per item, measured agreement (Cohen's kappa ≥ 0.7 target), disputed items adjudicated by a senior reviewer.
- **Golden test set:** frozen, never used for training or tuning, refreshed on a schedule with newer events to prevent temporal leakage.
- **Bias control:** balance across topics, political leanings, regions and source types; document known gaps.
- **Trusted source registry:** owned and reviewed by editorial leadership; changes are logged.
- **Retention and deletion:** defined per data class and enforced automatically.

## 10. Legal, Ethical and Compliance Requirements

- Compliance with applicable data-protection and intermediary/online-content regulations in each operating region (for example India's DPDP Act 2023 and IT Rules 2021 where relevant). **Legal counsel to confirm applicability before launch.**
- Defamation risk review before any public-facing label.
- Publish plain-language documentation of what the system can and cannot do, including known limitations.
- Neutrality policy: the system must not encode political or ideological positions; fairness metrics are reviewed periodically by the ethics lead.
- Clear disclosure that verdicts are assisted by automation and confirmed by humans.

## 11. Acceptance Criteria (Release Gates)

A release may go live only if **all** are met on the frozen golden test set and a fresh out-of-time sample:

| Gate | Threshold (to be confirmed by sponsor) |
| --- | --- |
| False-positive rate on true content labelled "Likely False" | ≤ 2% |
| Precision of "Contradicted" verdicts | ≥ 95% |
| Macro-F1 across verdict classes | ≥ 0.85 |
| Calibration error | ≤ 0.05 |
| Evidence citation coverage on non-abstained verdicts | 100% |
| Performance gap between subgroups (topic, region, source type) | ≤ 5 percentage points |
| Adversarial test suite (paraphrase, typos, injected instructions, satirical mimicry) | No critical failures |
| Security and privacy review | Passed |
| Reviewer usability test | ≥ 80% task completion without assistance |

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| True news wrongly labelled false | Reputational and legal harm, censorship concerns | Asymmetric thresholds, abstention, evidence requirement, mandatory human review, appeal process |
| Model bias against topics, regions or outlets | Unfair treatment, loss of trust | Balanced data, subgroup metrics as release gates, periodic audits |
| Concept drift as new narratives emerge | Silent accuracy decay | Drift monitoring, scheduled re-evaluation, fresh test data, rollback capability |
| Adversarial manipulation (paraphrasing, poisoned sources, injected instructions) | Evasion or false flags | Adversarial testing, source allow-list, input sanitisation, rate limits |
| Over-reliance by reviewers (automation bias) | Rubber-stamped errors | Show evidence before model verdict, sample-audit overrides, second review for high impact |
| Fast-moving stories with no evidence yet | Premature verdicts | Provisional labels, evidence-age checks, abstention |
| Poor label quality | Unreliable model | Dual annotation, agreement metrics, adjudication |
| Data licensing or privacy breach | Legal exposure | Provenance checks, minimisation, retention limits |

## 13. Assumptions, Constraints and Dependencies

**Assumptions**

- A trained reviewer team is available and empowered to override the model.
- Access to trusted evidence sources is licensed or otherwise permitted.
- English is the launch language.

**Constraints**

- No automated enforcement actions in v1.
- Budget, timeline and infrastructure to be confirmed by the sponsor.

**Dependencies**

- Licensed datasets and trusted-source access.
- Legal review sign-off.
- Reviewer training and editorial policy.

## 14. Phased Delivery

| Phase | Outcome | Exit criteria |
| --- | --- | --- |
| 1. Foundation | Data pipeline, trusted-source registry, golden test set, annotation guidelines | Label agreement target met; legal review started |
| 2. Assisted pilot | Claim extraction, evidence retrieval, verdicts shown to reviewers only (shadow mode) | All §11 gates met in shadow mode |
| 3. Controlled release | Reviewer tool live with mandatory human confirmation; monitoring and appeals active | 90 days stable metrics; no critical incidents |
| 4. Expansion | Additional languages and content types, each with its own evaluation | Separate gate review per expansion |

## 15. Traceability

Each requirement above maps to an objective and a release gate: O-1 → BR-08, BR-10 · O-2 → BR-03, BR-04, BR-05, BR-07, gates 1–2 · O-3 → BR-03, BR-06 · O-4 → BR-04, BR-05, gate 4 · O-5 → BR-11, BR-12, BR-13.

## 16. Sign-Off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Business sponsor |  |  |  |
| Editorial / fact-check lead |  |  |  |
| Legal and compliance |  |  |  |
| Engineering lead |  |  |  |
| Trust and safety / ethics lead |  |  |  |