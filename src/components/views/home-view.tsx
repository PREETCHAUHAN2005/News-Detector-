"use client";
/**
 * HomeView — the Cursor-style homescreen: greeting, evidence-verification
 * composer, known fact-check suggestions, recent analyses and the safety strip.
 */
import { useRef, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  BookMarked,
  ClipboardCheck,
  FlaskConical,
  Inbox,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, VerdictBadge } from "@/components/verdict/verdict-badge";
import { useToast } from "@/hooks/use-toast";
import { analyzeText, fetchAnalyses, fetchSuggestions } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { AnalysisDTO, SuggestionDTO } from "@/types/api";
import { cn } from "@/lib/utils";

const MODES = ["Claim", "Article", "URL"] as const;
type Mode = (typeof MODES)[number];

/** Extract the HTTP status from an ApiError without leaking `any`. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const value = (error as { status: unknown }).status;
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** Colour the evidence hint chip by its semantics. */
function hintClass(hint: string): string {
  if (hint.includes("support")) return "text-emerald-400";
  if (hint.includes("contradict") || hint.includes("fabricat")) return "text-rose-400";
  if (hint.includes("mixed")) return "text-amber-300";
  return "text-zinc-500";
}

export function HomeView() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setView = useAppStore((s) => s.setView);
  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const markAnalyzed = useAppStore((s) => s.markAnalyzed);

  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("Claim");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const suggestionsQuery = useQuery({
    queryKey: ["suggestions"],
    queryFn: fetchSuggestions,
  });
  const suggestions: SuggestionDTO[] = suggestionsQuery.data ?? [];

  const recentQuery = useQuery({
    queryKey: ["analyses", "recent"],
    queryFn: () => fetchAnalyses({ pageSize: 8 }),
  });
  const recent: AnalysisDTO[] = recentQuery.data?.analyses ?? [];

  // pending-review count for the reviewer CTA (shares the sidebar's cache)
  const pendingQuery = useQuery({
    queryKey: ["analyses", "pending-count"],
    queryFn: () => fetchAnalyses({ status: "pending_review", pageSize: 1 }),
  });
  const pendingCount = pendingQuery.data?.total ?? 0;
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const canReview = ["reviewer", "senior_reviewer", "admin"].includes(role);

  const analyzeMutation = useMutation({
    mutationFn: (input: string) => analyzeText(input),
    onSuccess: (result) => {
      toast({
        title: "Analysis complete",
        description: result.reused
          ? "Reused a previously human-verified verdict (BR-08)"
          : "Model recommendation filed for human review",
      });
      markAnalyzed();
      void queryClient.invalidateQueries({ queryKey: ["analyses"] });
      openAnalysis(result.analysis.id);
    },
    onError: (error: Error) => {
      const status = httpStatus(error);
      toast({
        variant: "destructive",
        title: "Analysis failed",
        description:
          status === 429
            ? "Rate limit reached — please wait a few seconds and try again."
            : error.message,
      });
    },
  });

  const charCount = text.length;
  const counterClass =
    charCount > 60000 ? "text-rose-400" : charCount > 20000 ? "text-amber-300" : "text-zinc-500";
  const analyzing = analyzeMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || analyzing) return;
    analyzeMutation.mutate(trimmed);
  }

  /** ⌘↩ / Ctrl+↩ submits from anywhere inside the composer. */
  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || analyzing) return;
      analyzeMutation.mutate(trimmed);
    }
  }

  function applySuggestion(suggestion: SuggestionDTO): void {
    setText(suggestion.text);
    document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    textareaRef.current?.focus();
  }

  const displayName = session?.user?.name?.trim() ?? "";
  const firstName = displayName ? displayName.split(/\s+/)[0] : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-10">
        {/* Greeting */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          aria-label="Welcome"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            <span className="mr-1.5 inline-block align-baseline text-amber-300" aria-hidden="true">
              👋
            </span>
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Paste a claim, headline or article — Veritas extracts the checkable claims, retrieves
            cited evidence, and recommends a graded verdict for human review.
          </p>
        </motion.section>

        {/* Reviewer CTA — jump straight into the queue when work is waiting */}
        {canReview && pendingCount > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.03, ease: "easeOut" }}
            aria-label="Pending review"
          >
            <div className="group flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/35 bg-gradient-to-r from-amber-500/[0.13] to-transparent p-3.5 shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)] transition-colors hover:border-amber-500/50">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10"
                aria-hidden
              >
                <ClipboardCheck className="size-4 text-amber-300" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">
                  <span className="font-mono tabular-nums text-amber-300">{pendingCount}</span>{" "}
                  {pendingCount === 1 ? "analysis is" : "analyses are"} awaiting human review
                </p>
                <p className="text-xs text-zinc-500">
                  Evidence is shown before each recommendation — high-impact claims need a senior
                  second sign-off (BR-12).
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setView("review")}
                className="h-8 shrink-0 border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 hover:border-amber-500/50 hover:bg-amber-500/20 hover:text-amber-100"
              >
                Open review queue
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Button>
            </div>
          </motion.section>
        )}

        {/* Composer */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06, ease: "easeOut" }}
          aria-labelledby="composer-heading"
        >
          <h2 id="composer-heading" className="sr-only">
            Verify content with evidence
          </h2>
          <form onSubmit={handleSubmit}>
            <div
              className={cn(
                "overflow-hidden rounded-xl border bg-zinc-900/50 transition-all duration-200",
                "border-zinc-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
                "focus-within:border-emerald-500/40 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),0_0_28px_-8px_rgba(16,185,129,0.35)]"
              )}
            >
              <label htmlFor="composer-input" className="sr-only">
                Statement to verify
              </label>
              <Textarea
                id="composer-input"
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Paste a news article, headline, or claim to verify…"
                aria-describedby="composer-hint"
                className="min-h-[120px] resize-y border-0 bg-transparent px-4 pt-4 text-[15px] leading-relaxed text-zinc-100 shadow-none outline-none placeholder:text-zinc-600 focus-visible:border-0 focus-visible:ring-0"
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-zinc-800/80 px-3 py-2.5">
                {/* Mode chips — visual hint only */}
                <div
                  role="group"
                  aria-label="Input mode"
                  className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1"
                >
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                      className={cn(
                        "flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                        mode === m
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <span
                  className={cn("ml-auto font-mono text-[11px] tabular-nums", counterClass)}
                  title="Analyses accept up to 60,000 characters (safety-capped)"
                >
                  {charCount.toLocaleString()} / 20,000
                </span>

                <Button
                  type="submit"
                  disabled={!text.trim() || analyzing}
                  className="h-10 w-full gap-2.5 rounded-lg font-medium sm:w-auto"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Retrieving evidence…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" aria-hidden="true" />
                      Verify with evidence
                      <kbd className="veritas-kbd ml-1 hidden sm:inline-flex" aria-hidden>
                        ⌘↩
                      </kbd>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
          <p
            id="composer-hint"
            className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-500"
          >
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-400/80" aria-hidden="true" />
            Uses the trusted-source registry · verdicts cite evidence · abstains when unsure
          </p>
        </motion.section>

        {/* Suggestion cards */}
        <section aria-labelledby="suggestions-heading">
          <div className="flex flex-col gap-1">
            <h2 id="suggestions-heading" className="text-sm font-semibold text-zinc-200">
              Try a known fact-check
            </h2>
            <p className="text-xs leading-relaxed text-zinc-500">
              Statements with published PolitiFact rulings — exercises the duplicate-reuse path;
              novel ones honestly abstain.
            </p>
          </div>

          {suggestionsQuery.isLoading ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : suggestions.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {suggestions.map((suggestion, index) => (
                <motion.button
                  key={`${suggestion.kind}-${index}`}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.04 * index, ease: "easeOut" }}
                  onClick={() => applySuggestion(suggestion)}
                  className="group flex h-full min-h-32 flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  <div className="flex items-center gap-2">
                    {suggestion.kind === "fact_checked" ? (
                      <BookMarked className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <FlaskConical className="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                    )}
                    <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      {suggestion.kind === "fact_checked" ? "Fact-checked" : "Novel claim"}
                    </span>
                    <span
                      className="ml-auto min-w-0 truncate text-[11px] text-zinc-600"
                      title={suggestion.speaker}
                    >
                      {suggestion.speaker}
                    </span>
                  </div>

                  <p className="line-clamp-3 text-[13px] leading-relaxed text-zinc-300 group-hover:text-zinc-200">
                    {suggestion.text}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
                    <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                      {suggestion.trueRating}
                    </span>
                    <span className="shrink-0 text-zinc-700" aria-hidden="true">
                      ·
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-zinc-500">
                      {suggestion.subject}
                    </span>
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-[11px] font-medium",
                        hintClass(suggestion.hint)
                      )}
                    >
                      {suggestion.hint}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          ) : null}
        </section>

        {/* Recent analyses */}
        <section aria-labelledby="recent-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="recent-heading" className="text-sm font-semibold text-zinc-200">
              Recent analyses
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView("review")}
              className="h-8 gap-1.5 text-emerald-400 hover:text-emerald-300"
            >
              View review queue
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          {recentQuery.isLoading ? (
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : recentQuery.isError ? (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-[13px] text-zinc-500">
              Couldn&apos;t load recent analyses —{" "}
              <button
                type="button"
                onClick={() => void recentQuery.refetch()}
                className="text-emerald-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                retry
              </button>
            </div>
          ) : recent.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
              <Inbox className="size-8 text-zinc-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-zinc-300">No analyses yet</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Paste a claim above or pick a suggestion — your first verdict will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-zinc-800/70">
              {recent.map((analysis) => (
                <button
                  key={analysis.id}
                  type="button"
                  onClick={() => openAnalysis(analysis.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  {analysis.highImpact ? (
                    <ShieldAlert
                      className="size-4 shrink-0 text-amber-300"
                      aria-label="High-impact claim"
                    />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-400 group-hover:text-zinc-200">
                    {analysis.inputText}
                  </span>
                  <VerdictBadge label={analysis.overallLabel} size="sm" className="shrink-0" />
                  <span className="hidden shrink-0 sm:block">
                    <StatusBadge status={analysis.status} />
                  </span>
                  <time
                    dateTime={analysis.createdAt}
                    className="shrink-0 whitespace-nowrap font-mono text-[11px] text-zinc-500"
                  >
                    {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                  </time>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Safety strip */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          aria-label="Safety notice"
        >
          <Alert className="rounded-xl border-amber-500/30 bg-amber-500/5">
            <Info className="size-4 text-amber-300" aria-hidden="true" />
            <AlertTitle className="text-[13px] font-medium text-amber-200/90">
              Veritas is decision support, not an automated judge.
            </AlertTitle>
            <AlertDescription className="text-[13px] leading-relaxed text-zinc-400">
              Every verdict requires human confirmation before any action. Wrongly calling true
              content false is treated as the worst failure — that&apos;s why the system abstains
              instead of guessing.
            </AlertDescription>
          </Alert>
        </motion.section>
      </div>
    </div>
  );
}
