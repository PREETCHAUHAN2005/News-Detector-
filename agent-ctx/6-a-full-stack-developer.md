# Work record — Task 6-a: Home + SignIn views

Task ID: 6-a
Agent: full-stack-developer (Home + SignIn views)
Task: Build `src/components/views/signin-view.tsx` (polished centered dark sign-in with one-click demo accounts) and `src/components/views/home-view.tsx` (Cursor-homescreen: greeting, evidence composer, known fact-check suggestions, recent analyses, safety strip) for the Veritas fake-news detection workbench.

## Files owned (created/overwritten ONLY these)
- /home/z/my-project/src/components/views/home-view.tsx
- /home/z/my-project/src/components/views/signin-view.tsx

## What was built

### SignInView
- Full-height centered layout on zinc-950 inside the shell's scrollable `main` (min-h-full + flex-1), with the `veritas-grid-bg` class on an absolutely-positioned decorative overlay (aria-hidden).
- Motion-staggered wordmark header (VeritasLogo size-11 + "Veritas" h1 + tagline "Evidence-first fact-checking workbench").
- Card (max-w-md, rounded-xl, zinc-900/60, Card/CardContent from shadcn): Email + Password (Label + Input, autoComplete="email"/"current-password"), inline error `<p role="alert" aria-live="polite">` ("Invalid credentials" on CredentialsSignin), full-width emerald submit (default variant = bg-primary emerald-400) with Loader2 "Signing in…" while awaiting `signIn("credentials", {email, password, redirect:false})`. On success the button intentionally stays in loading state — SessionProvider flips `status` to "authenticated" and the shell re-renders into the workbench (no router.refresh needed).
- Demo accounts section (Separator + "Demo accounts" heading + explainer): three one-click buttons (Priya Sharma/Reviewer emerald, Marcus Chen/Senior reviewer amber, Avery Wallace/Admin rose) each showing role badge, one-line capability description, mono email; click sets state and immediately submits with password "veritas123". Focus-visible emerald rings, ArrowRight nudge on hover.
- Footer strip: "Assisted by automation, confirmed by humans · Veritas v1.0" + tiny mono uppercase "Phase 2 shadow deployment".

### HomeView
- Centered max-w-3xl column, px-4 sm:px-6 py-8, gap-10 stack of five sections, all motion.fade-in staggered (light).
- Greeting: "👋 Welcome back, {firstName}" (emoji wrapped in amber span, aria-hidden) + the evidence-first subline. Name from useSession, null-safe fallback.
- Composer card (focal point): rounded-xl border zinc-800 bg-zinc-900/50 with focus-within emerald ring; transparent borderless Textarea (min-h-120, aria-describedby hint); bottom row = Claim/Article/URL toggle chips (aria-pressed, visual-only), font-mono char counter (amber >20000, red >60000), emerald "Verify with evidence" submit (Sparkles; disabled when empty/pending; Loader2 + "Retrieving evidence…" while pending; w-full on mobile). Hint under card: "Uses the trusted-source registry · verdicts cite evidence · abstains when unsure" with ShieldCheck.
- Submit: `analyzeText` via useMutation → success: toast "Analysis complete" (BR-08 reuse vs "filed for human review" description), markAnalyzed(), invalidate ["analyses"], openAnalysis(id). Error: destructive toast "Analysis failed" with friendly 429 rate-limit message (status extracted via a typed `httpStatus()` guard — no `any`).
- Suggestions: useQuery ["suggestions"] → fetchSuggestions (SuggestionDTO[]); sm:grid-cols-2 cards = buttons that fill the composer + smooth-scroll `#main-content` to top + focus textarea. Card: BookMarked (emerald) for fact_checked / FlaskConical (amber) for novel, kind label + speaker, statement line-clamp-3 text-[13px], footer with trueRating mono pill + subject + semantic hint (supports=emerald / contradicts-fabricated=rose / mixed=amber / abstains=zinc). 4 skeletons while loading; section hidden when empty.
- Recent analyses: useQuery ["analyses","recent"] fetchAnalyses({pageSize:8}); header + ghost "View review queue" → setView("review"); compact divide-y rows (not cards): high-impact ShieldAlert amber icon (spacer keeps alignment), truncated input, VerdictBadge sm, StatusBadge (hidden < sm), relative time via date-fns formatDistanceToNow in font-mono. Skeletons / error-with-retry / friendly Inbox empty state. Row click → openAnalysis(id).
- Safety strip: shadcn Alert border-amber-500/30 bg-amber-500/5 with Info icon — "Veritas is decision support, not an automated judge…" (asymmetric-error-cost abstention note).

## Verification (browser end-to-end, agent-browser isolated session)
- Sign-in renders (a11y tree: wordmark h1, labelled email/password, Sign in, DEMO ACCOUNTS h2 + 3 role buttons); one-click demo login → "Welcome back, Priya".
- All Home sections render with live seeded data: 6 suggestion cards (5 fact_checked incl. Pants on Fire/False/Half True/True/Mostly True + 1 novel "abstains (no evidence)"), 8 recent rows with badges/status/relative times/high-impact icons.
- Suggestion click fills composer + enables submit; submit fires POST /api/analyze; error path verified — destructive toast "Analysis failed" captured in DOM.
- Recent row click → view switches to analysis dossier; "View review queue" → review view. Mobile 390×844 snapshot verified (status badge hidden, single column, shell drawer nav).
- `bun run lint` clean; `bunx tsc --noEmit` — zero errors in both of my files; dev.log clean for these views.

## Blockers found in OTHER agents' files (not touched, needs orchestrator)
1. **src/app/api/analyze/route.ts line 70** — `db.claim.findMany({ orderBy: { createdAt: "desc" } })` → PrismaClientValidationError (Claim model has NO `createdAt` column) → POST /api/analyze always 500 "Analysis failed". Fix: orderBy on `analysis: { createdAt: "desc" }` or drop the orderBy. Blocks Home's success toast/openAnalysis flow.
2. **src/app/api/analyses/[id]/route.ts line 39** — `include: { appeals: ... }` on Analysis (appeals relation lives on Verdict, not Analysis) → GET /api/analyses/[id] 500 "Failed to fetch analysis". Blocks AnalysisView dossier. (6-b's view already handles it with a retry state.)
3. tsc --noEmit also flags unrelated pre-existing errors in api/analytics/route.ts, api/analyze/route.ts (verdict include), analytics-view.tsx (4× optional boolean) — for their owners.

## Ops note
- Dev server (3000) and nlp-engine (8001) had died during a mid-session flap; restarted both via double-fork orphan shells so they survive tool-call teardown; /api/health fully ok afterwards.
