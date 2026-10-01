# Work record — Task 6-b: Analysis + Review views

Task ID: 6-b
Agent: full-stack-developer (Analysis + Review views)
Task: Build `src/components/views/analysis-view.tsx` (evidence-first dossier) and `src/components/views/review-view.tsx` (reviewer triage queue) for the Veritas fake-news detection workbench.

## Files owned (created/overwritten ONLY these)
- /home/z/my-project/src/components/views/analysis-view.tsx
- /home/z/my-project/src/components/views/review-view.tsx

## What was built

### AnalysisView (evidence-first dossier, BR-10)
- Data: `useQuery(["analysis", activeAnalysisId], fetchAnalysis)` — skeleton (header + 2 claim cards), error state with Retry, "no analysis selected" guard. Scrolls `#main-content` to top on analysis change.
- Header card: StatusBadge + VerdictBadge(lg, overallLabel) + ConfidenceBar + `confidence N%` mono text + high-impact chip (ShieldAlert amber, Tooltip lists the 5 engine categories) + provisional chip (Clock amber) + quoted input block (border-l-2 zinc-700, italic, whitespace-pre-wrap) + mono meta row (id[0:8], modelVersion, latencyMs, relative createdAt, submittedBy, topic) + "Reuses prior human verdict (BR-08)" teal chip with similarity tooltip.
- Per claim (ordered by position): position badge, ClaimTypeChip (factual=emerald; opinion/satire/prediction=zinc + reason tooltip mirroring engine's `_classify_sentence`), claim text.
- **EVIDENCE FIRST (hard BRD §12 ordering): "Retrieved evidence" section (FolderSearch + count badge + `<EvidenceList/>`) renders BEFORE the verdict. A labelled divider ("model recommendation — shown after evidence") separates them. THEN the verdict block: VerdictBadge(lg) + ConfidenceGauge(140) side by side (stacks on mobile), "Why" explanation, verdict id + provisional note. StyleSignalsPanel under it (self-hides when empty).**
- Reviewer decision panel (role reviewer/senior/admin): no reviews → Accept (emerald) / Edit label (amber, inline Select of ALL_LABELS + confirm, requires selection) / Reject to Unverified (rose, requires notes textarea, submit disabled until filled). Reviewed → prominent "Final" human-verdict banner (effectiveLabel(claim) + BR-11 note) + review history (round badge, reviewer name+role, action chip, finalLabel badge, notes, timestamp; max-h-72 overflow-y-auto) + round-2 controls for seniors on high-impact ("Second review (mandatory for high-impact)") or amber "awaiting senior" note for non-seniors + appealed-state notice.
- Collapsible appeal + feedback: AppealForm (BR-14, any role, only when no review exists — name/email prefilled from session, reason ≥10 chars, live char counter, success note "tracked in Appeals view") + FeedbackForm (BR-15, reviewer+ — "Model was right"/"Model was wrong" with correctedLabel select + notes → toast "Feedback recorded as labelled training data").
- Back row: "← Back to home" + "Open review queue".

### ReviewView (triage dashboard, BR-10)
- Header: h1 + anti-automation-bias subtitle + role-aware chips (senior/reviewer/viewer variants).
- Sticky filter bar (top-0 z-10, backdrop-blur zinc-950/90, full-bleed via negative margins): debounced search (300ms, resets page), status Select (all/pending_review/in_review/reviewed/appealed), verdict Select (all + 5 labels), "High-impact only" toggle chip (aria-pressed), live result count (mono, pulses while fetching).
- Queue cards (button, keyboard accessible, hover border-zinc-600 + ChevronRight): StatusBadge + VerdictBadge(sm) + high-impact chip + BR-08 reuse chip (Tooltip) + latency badge (mono) + relative time; line-clamp-2 input text; meta strip (claims·assessable, citations, reviews count or "awaiting first review", topic). Empty state with clear-filters; 3 skeleton cards while loading; error state with retry.
- Pagination (pageSize 12, placeholderData keepPrevious): Prev/Next + "Page X of Y" mono; page clamped by deriving `currentPage = min(page, totalPages)` (render-phase adjust, no setState-in-effect — lint rule `react-hooks/set-state-in-effect` enforced).
- Framer-motion entrance animations; zinc/emerald/amber palette only.

## Verification
- `bun run lint` — clean (fixed initial `set-state-in-effect` violations by moving page resets into handlers + render-phase clamp).
- `bunx tsc --noEmit` — no errors in either view file (pre-existing errors in other agents' API routes remain untouched).
- Dev server compiles `/` 200 with both views statically imported.
- Mutations invalidate ["analysis", id], ["analyses"], ["sidebar-recent"] per spec.

## Key decisions
- Combined the needsSecondReview toast into a single "High-impact: awaiting mandatory senior second review" toast (TOAST_LIMIT=1 would replace the first one).
- Reviews sorted by `round` client-side (API orders by createdAt; belt-and-braces for effectiveLabel correctness).
- Claim-type tooltip texts mirror the Python engine's actual classification reasons.
- Appeal form hidden after filing (local state) since VerdictDTO carries no appeal list — success note points to the Appeals view, per spec simplification.
