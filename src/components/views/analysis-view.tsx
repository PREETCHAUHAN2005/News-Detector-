"use client";
/**
 * AnalysisView — the evidence-first dossier for a single analysis (BR-10).
 *
 * HARD ORDERING REQUIREMENT (BRD §12, anti-automation-bias): for every
 * claim, the retrieved evidence is rendered BEFORE the model recommendation.
 * Do not reorder the sections inside <ClaimCard />.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  CopyPlus,
  Download,
  FileSearch,
  FolderSearch,
  Gavel,
  ListChecks,
  Loader2,
  MessageSquareWarning,
  PenLine,
  RotateCw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

import { fileAppeal, fetchAnalysis, submitFeedback, submitReview } from "@/lib/api";
import { ALL_LABELS, LABEL_META, REVIEWER_ROLES, ROLE_DISPLAY, SENIOR_ROLES } from "@/lib/taxonomy";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { effectiveLabel } from "@/types/api";
import type { AnalysisDTO, ClaimDTO, ReviewDTO, VerdictDTO, VerdictLabel } from "@/types/api";
import { ConfidenceBar, ConfidenceGauge } from "@/components/verdict/confidence-gauge";
import { EvidenceList } from "@/components/verdict/evidence-list";
import { StyleSignalsPanel } from "@/components/verdict/style-signals";
import { StatusBadge, VerdictBadge } from "@/components/verdict/verdict-badge";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Sensitive-topic categories behind the high-impact flag (mirrors the engine). */
const HIGH_IMPACT_CATEGORIES = [
  "Elections",
  "Health",
  "Public safety",
  "Public figures",
  "Finance",
];

/** Human-readable KB rating slugs for the exported report. */
const RATING_LABELS: Record<string, string> = {
  true: "True",
  "mostly-true": "Mostly True",
  "half-true": "Half True",
  "barely-true": "Mostly False",
  false: "False",
  "pants-fire": "Pants on Fire",
};

/** Build a citation-ready Markdown dossier for offline/editorial use (BRD §12 transparency). */
function buildReportMarkdown(analysis: AnalysisDTO): string {
  const lines: string[] = [];
  const confidence =
    typeof analysis.overallConfidence === "number"
      ? ` (${Math.round(analysis.overallConfidence * 100)}% calibrated confidence)`
      : "";
  lines.push(`# Veritas Analysis Report`);
  lines.push("");
  lines.push(`**Analysis:** #${analysis.id.slice(0, 8)}`);
  lines.push(`**Overall model recommendation:** ${analysis.overallLabel ?? "—"}${confidence}`);
  lines.push(`**Status:** ${analysis.status}`);
  lines.push(
    `**High-impact:** ${analysis.highImpact ? "yes — senior second review required (BR-12)" : "no"}`
  );
  if (analysis.topic) lines.push(`**Topic:** ${analysis.topic}`);
  lines.push(
    `**Engine:** ${analysis.modelVersion ?? "n/a"} · latency ${analysis.latencyMs ?? "n/a"}ms`
  );
  lines.push(`**Created:** ${new Date(analysis.createdAt).toISOString()}`);
  if (analysis.submittedBy) lines.push(`**Submitted by:** ${analysis.submittedBy.name}`);
  if (analysis.duplicateOfId) {
    lines.push(
      `**Duplicate reuse (BR-08):** #${analysis.duplicateOfId.slice(0, 8)} (${Math.round(
        (analysis.duplicateSimilarity ?? 0) * 100
      )}% statement match)`
    );
  }
  lines.push("");
  lines.push(`## Input`);
  lines.push("");
  lines.push(`> ${analysis.inputText.replace(/\n/g, "\n> ")}`);
  lines.push("");

  const claims = [...analysis.claims].sort((a, b) => a.position - b.position);
  claims.forEach((claim, i) => {
    lines.push(`## Claim ${i + 1} — ${claim.claimType}${claim.assessable ? "" : " (not assessable)"}`);
    lines.push("");
    lines.push(`> ${claim.text}`);
    lines.push("");
    const verdict = claim.verdict;
    if (!verdict) {
      lines.push(`_No verdict issued._`);
      lines.push("");
      return;
    }
    if (verdict.evidence.length > 0) {
      lines.push(`### Evidence — shown before the verdict (BR-05)`);
      lines.push("");
      verdict.evidence.forEach((e) => {
        const rating = RATING_LABELS[e.kbRating] ?? e.kbRating;
        lines.push(
          `${e.rank}. **${rating}** (${Math.round(e.similarity * 100)}% match) — "${e.excerpt}"${
            e.speaker ? ` — ${e.speaker}` : ""
          }${e.context ? `, ${e.context}` : ""}`
        );
        lines.push(`   Source: ${e.url}`);
      });
      lines.push("");
    } else {
      lines.push(`_No evidence above the citation floor — no verdict can be responsibly issued._`);
      lines.push("");
    }
    lines.push(`### Model recommendation`);
    lines.push("");
    lines.push(`- **Label:** ${verdict.label}`);
    lines.push(
      `- **Confidence:** ${Math.round(verdict.confidence * 100)}%${
        verdict.abstained ? " (abstained — below the safety bar)" : ""
      }`
    );
    lines.push(`- **Why:** ${verdict.explanation}`);
    if (verdict.provisional) lines.push(`- **Provisional:** fast-moving subject`);
    if (verdict.styleSignals) {
      lines.push(`- **Style signals (display-only, BR-07):** ${verdict.styleSignals}`);
    }
    lines.push("");
    if (verdict.reviews.length > 0) {
      lines.push(`### Human review (BR-11 — the human decision is final)`);
      lines.push("");
      verdict.reviews.forEach((r) => {
        lines.push(
          `- Round ${r.round} — ${r.reviewer?.name ?? "reviewer"} (${
            r.reviewer?.role ?? "unknown role"
          }) **${r.action}**${r.finalLabel ? ` → ${r.finalLabel}` : ""}${
            r.notes ? ` — "${r.notes}"` : ""
          }`
        );
      });
      lines.push("");
    }
  });
  lines.push(`---`);
  lines.push(
    `_Generated by Veritas — assisted by automation, confirmed by humans. Shadow-mode deployment: the model output above is a recommendation, never a decision._`
  );
  return lines.join("\n");
}

/** Download the dossier as a Markdown file (client-side blob, no server round-trip). */
function downloadReport(analysis: AnalysisDTO): void {
  const blob = new Blob([buildReportMarkdown(analysis)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `veritas-report-${analysis.id.slice(0, 8)}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const CLAIM_TYPE_REASONS: Record<string, string> = {
  factual: "Declarative statement with checkable content (entities, quantities or events).",
  opinion: "Subjective framing / value judgment — opinions are excluded from truth assessment (BR-02).",
  satire: "Satire or parody markers detected — excluded from truth assessment (BR-02).",
  prediction: "Forward-looking statement — the outcome has not occurred yet (BR-02).",
};

interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string;
}

/** Invalidate everything that shows analysis state after a mutation. */
function useAnalysisInvalidation(analysisId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["analysis", analysisId] });
    void queryClient.invalidateQueries({ queryKey: ["analyses"] });
    void queryClient.invalidateQueries({ queryKey: ["sidebar-recent"] });
  }, [queryClient, analysisId]);
}

export function AnalysisView() {
  const activeAnalysisId = useAppStore((s) => s.activeAnalysisId);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;
  const role = user?.role ?? "viewer";
  const isReviewer = REVIEWER_ROLES.includes(role);
  const isSenior = SENIOR_ROLES.includes(role);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["analysis", activeAnalysisId],
    queryFn: () => fetchAnalysis(activeAnalysisId ?? ""),
    enabled: Boolean(activeAnalysisId),
  });

  // dossier always starts at the top of the scroll container
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  }, [activeAnalysisId]);

  if (!activeAnalysisId) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-20 text-center sm:px-6">
        <FileSearch className="size-9 text-zinc-700" aria-hidden />
        <p className="text-sm text-zinc-400">No analysis selected.</p>
        <Button variant="outline" size="sm" onClick={() => setView("home")}>
          <ArrowLeft /> Back to home
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <AnalysisSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-20 text-center sm:px-6">
        <FileSearch className="size-9 text-zinc-700" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Couldn&apos;t load this analysis</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {error instanceof Error ? error.message : "Please try again."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RotateCw /> Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setView("home")}>
            <ArrowLeft /> Back to home
          </Button>
        </div>
      </div>
    );
  }

  const analysis = data.analysis;
  const claims = [...analysis.claims].sort((a, b) => a.position - b.position);
  const anyProvisional = claims.some((c) => c.verdict?.provisional);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <DossierHeader analysis={analysis} anyProvisional={anyProvisional} />

      <section aria-label="Claim-by-claim analysis" className="mt-6 space-y-6">
        {claims.map((claim, index) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            analysis={analysis}
            index={index}
            isReviewer={isReviewer}
            isSenior={isSenior}
            viewerName={user?.name ?? ""}
            viewerEmail={user?.email ?? ""}
          />
        ))}
      </section>

      {/* Back row */}
      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-zinc-800/80 pt-5">
        <Button variant="outline" size="sm" onClick={() => setView("home")}>
          <ArrowLeft /> Back to home
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setView("review")} className="text-emerald-400 hover:text-emerald-300">
          <ListChecks /> Open review queue
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            try {
              downloadReport(analysis);
              toast({
                title: "Report exported",
                description: `veritas-report-${analysis.id.slice(0, 8)}.md — evidence, verdicts and review history included.`,
              });
            } catch {
              toast({
                variant: "destructive",
                title: "Export failed",
                description: "The report could not be generated in this browser.",
              });
            }
          }}
        >
          <Download /> Export report
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────── Header ────────────────────────────── */

function DossierHeader({ analysis, anyProvisional }: { analysis: AnalysisDTO; anyProvisional: boolean }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6"
      aria-label="Analysis summary"
    >
      {/* badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={analysis.status} />
        <VerdictBadge label={analysis.overallLabel} size="lg" />
        {typeof analysis.overallConfidence === "number" && (
          <span
            className="flex items-center gap-2"
            title={`Overall calibrated confidence ${Math.round(analysis.overallConfidence * 100)}%`}
          >
            <ConfidenceBar
              confidence={analysis.overallConfidence}
              label={analysis.overallLabel}
              abstained={analysis.overallLabel === "Unverified"}
            />
            <span className="font-mono text-[11px] text-zinc-500">confidence</span>
          </span>
        )}
        {analysis.highImpact && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                <ShieldAlert className="size-3.5" aria-hidden />
                High-impact — second review required
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-60 border border-zinc-800 bg-zinc-900 text-left text-zinc-200"
            >
              <p className="font-semibold">Sensitive-topic categories (BR-12):</p>
              <p className="mt-1 leading-relaxed text-zinc-400">
                {HIGH_IMPACT_CATEGORIES.join(" · ")} — every verdict needs a senior
                countersign before the analysis counts as reviewed.
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {anyProvisional && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                <Clock className="size-3.5" aria-hidden />
                Provisional — fast-moving subject
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-60 border border-zinc-800 bg-zinc-900 text-left text-zinc-300">
              At least one claim touches a rapidly evolving subject — the verdict may age
              quickly and is flagged provisional by the engine.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* input text */}
      <blockquote className="mt-4 border-l-2 border-zinc-700 bg-zinc-900/50 py-3 pl-4 pr-3">
        <p className="line-clamp-none whitespace-pre-wrap text-sm italic leading-relaxed text-zinc-300">
          {analysis.inputText}
        </p>
      </blockquote>

      {/* meta row */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11px] text-zinc-500">
        <span title={analysis.id} className="text-zinc-400">
          #{analysis.id.slice(0, 8)}
        </span>
        {analysis.modelVersion && <span>· {analysis.modelVersion}</span>}
        {typeof analysis.latencyMs === "number" && <span>· {analysis.latencyMs}ms</span>}
        <span>
          ·{" "}
          <time dateTime={analysis.createdAt}>
            {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
          </time>
        </span>
        {analysis.submittedBy && <span>· by {analysis.submittedBy.name}</span>}
        {analysis.topic && (
          <span className="inline-flex items-center rounded border border-zinc-700/80 bg-zinc-800/60 px-1.5 py-0.5 uppercase tracking-wide text-zinc-400">
            topic: {analysis.topic}
          </span>
        )}
        {analysis.duplicateOfId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-teal-300">
                <CopyPlus className="size-3" aria-hidden />
                Reuses prior human verdict (BR-08)
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 border border-zinc-800 bg-zinc-900 text-left text-zinc-300">
              Near-duplicate of analysis #{analysis.duplicateOfId.slice(0, 8)}
              {typeof analysis.duplicateSimilarity === "number" &&
                ` (${Math.round(analysis.duplicateSimilarity * 100)}% statement match)`}
              — the stored human ruling was reused instead of issuing a fresh model verdict.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </motion.header>
  );
}

/* ───────────────────────────── Claim card ───────────────────────────── */

function ClaimCard({
  claim,
  analysis,
  index,
  isReviewer,
  isSenior,
  viewerName,
  viewerEmail,
}: {
  claim: ClaimDTO;
  analysis: AnalysisDTO;
  index: number;
  isReviewer: boolean;
  isSenior: boolean;
  viewerName: string;
  viewerEmail: string;
}) {
  const verdict = claim.verdict;
  const hasReviews = (verdict?.reviews.length ?? 0) > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.06, 0.3), ease: "easeOut" }}
      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6"
      aria-label={`Claim ${claim.position + 1}`}
    >
      {/* claim header */}
      <header>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-300"
            aria-label={`Claim number ${claim.position + 1}`}
          >
            #{String(claim.position + 1).padStart(2, "0")}
          </span>
          <ClaimTypeChip type={claim.claimType} />
        </div>
        <p className="text-[15px] leading-relaxed text-zinc-100">{claim.text}</p>
      </header>

      {/* ── EVIDENCE FIRST (BRD §12 anti-automation-bias — do not reorder) ── */}
      <section aria-label="Retrieved evidence" className="mt-5">
        <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <FolderSearch className="size-4 text-emerald-400/80" aria-hidden />
          Retrieved evidence
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-normal text-zinc-400">
            {verdict?.evidence.length ?? 0}
          </span>
        </h3>
        <EvidenceList evidence={verdict?.evidence ?? []} />
      </section>

      {/* divider: evidence above, model recommendation below */}
      <div
        className="my-6 flex items-center gap-3"
        role="separator"
        aria-label="End of evidence — model recommendation follows"
      >
        <div className="h-px flex-1 bg-zinc-800/80" />
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">
          <ChevronDown className="size-3" aria-hidden />
          model recommendation — shown after evidence
          <ChevronDown className="size-3" aria-hidden />
        </span>
        <div className="h-px flex-1 bg-zinc-800/80" />
      </div>

      {/* model recommendation */}
      {verdict ? (
        <>
          <section
            aria-label="Model recommendation"
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5"
          >
            <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              <FileSearch className="size-3.5" aria-hidden />
              Model recommendation
            </p>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
                <VerdictBadge label={verdict.label} size="lg" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-600">
                  <span title={verdict.id}>verdict {verdict.id.slice(0, 8)}</span>
                  {verdict.provisional && (
                    <span className="inline-flex items-center gap-1 text-amber-300/90">
                      <Clock className="size-3" aria-hidden /> provisional — fast-moving subject
                    </span>
                  )}
                </div>
              </div>
              <ConfidenceGauge
                confidence={verdict.confidence}
                label={verdict.label}
                abstained={verdict.abstained}
                size={140}
              />
            </div>
            <div className="mt-5 border-t border-zinc-800/70 pt-4">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Why</h4>
              <p className="text-[13px] leading-relaxed text-zinc-300">{verdict.explanation}</p>
            </div>
          </section>
          {/* secondary style signals — self-labels as display-only */}
          <div className="mt-4">
            <StyleSignalsPanel signals={verdict.styleSignals} />
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
          No verdict was produced for this claim.
        </p>
      )}

      {/* reviewer decision panel */}
      {verdict && isReviewer && (
        <div className="mt-5">
          <ReviewerDecisionPanel claim={claim} verdict={verdict} analysis={analysis} isSenior={isSenior} />
        </div>
      )}

      {/* appeal + feedback */}
      {verdict && (!hasReviews || isReviewer) && (
        <div className="mt-4">
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3.5 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
              <span className="flex items-center gap-2">
                <MessageSquareWarning className="size-4 text-amber-400/80" aria-hidden />
                Appeal &amp; reviewer feedback
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              {!hasReviews && (
                <AppealForm
                  verdictId={verdict.id}
                  analysisId={analysis.id}
                  defaultName={viewerName}
                  defaultEmail={viewerEmail}
                />
              )}
              {isReviewer && <FeedbackForm verdictId={verdict.id} />}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </motion.article>
  );
}

function ClaimTypeChip({ type }: { type: string }) {
  const display = type.charAt(0).toUpperCase() + type.slice(1);
  if (type === "factual") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
        {display}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
          {display}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 border border-zinc-800 bg-zinc-900 text-left text-zinc-300">
        {CLAIM_TYPE_REASONS[type] ?? "Engine claim-type classification."}
      </TooltipContent>
    </Tooltip>
  );
}

/* ───────────────────── Reviewer decision panel ───────────────────── */

function ReviewerDecisionPanel({
  claim,
  verdict,
  analysis,
  isSenior,
}: {
  claim: ClaimDTO;
  verdict: VerdictDTO;
  analysis: AnalysisDTO;
  isSenior: boolean;
}) {
  const reviews = useMemo(
    () => [...verdict.reviews].sort((a, b) => a.round - b.round),
    [verdict.reviews]
  );
  const eff = effectiveLabel(claim);

  const firstRound = reviews.length === 0;
  const awaitingSecond = analysis.highImpact && reviews.length === 1;
  const seniorTurn = awaitingSecond && isSenior;

  return (
    <section
      aria-label="Reviewer decision"
      className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300">
          <Gavel className="size-3.5 text-emerald-400" aria-hidden />
          Reviewer decision
        </h4>
        <span className="text-[11px] text-zinc-500">
          BR-11 — the human decision is final and overrides the model
        </span>
      </div>

      {/* human verdict banner */}
      {reviews.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
            Final
          </span>
          <VerdictBadge label={eff.label} size="lg" />
          <p className="w-full text-[11px] leading-relaxed text-zinc-400 sm:w-auto sm:flex-1">
            Human verdict — the reviewer decision is final and overrides the model
            recommendation (BR-11).
          </p>
        </div>
      )}

      {firstRound && <ReviewControls verdict={verdict} analysisId={analysis.id} />}

      {seniorTurn && (
        <ReviewControls
          verdict={verdict}
          analysisId={analysis.id}
          heading="Second review (mandatory for high-impact)"
        />
      )}

      {awaitingSecond && !isSenior && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-300">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          Awaiting mandatory senior second review (BR-12) — this analysis stays
          &ldquo;In review&rdquo; until a senior reviewer countersigns.
        </p>
      )}

      {reviews.length >= 2 && (
        <p className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
          <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
          Both review rounds are complete — the human verdict is locked.
        </p>
      )}

      {analysis.status === "appealed" && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3.5 py-2.5 text-xs text-rose-300">
          <MessageSquareWarning className="size-3.5 shrink-0" aria-hidden />
          An appeal has been filed on this analysis (BR-14) — resolution is tracked in the
          Appeals view.
        </p>
      )}

      {reviews.length > 0 && <ReviewHistory reviews={reviews} />}
    </section>
  );
}

function ReviewHistory({ reviews }: { reviews: ReviewDTO[] }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Review history
      </p>
      <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {reviews.map((review) => (
          <li key={review.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-300"
                aria-label={`Review round ${review.round}`}
              >
                R{review.round}
              </span>
              <span className="text-xs font-medium text-zinc-200">
                {review.reviewer?.name ?? "Reviewer"}
              </span>
              {review.reviewer?.role && (
                <span className="text-[11px] text-zinc-500">
                  {ROLE_DISPLAY[review.reviewer.role] ?? review.reviewer.role}
                </span>
              )}
              <ActionChip action={review.action} />
              <span className="ml-auto font-mono text-[10px] text-zinc-600">
                <time dateTime={review.createdAt}>
                  {format(new Date(review.createdAt), "MMM d, yyyy · HH:mm")}
                </time>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-zinc-500">final label:</span>
              <VerdictBadge label={review.finalLabel} size="sm" />
            </div>
            {review.notes && (
              <p className="mt-2 whitespace-pre-wrap border-l-2 border-zinc-700 pl-2.5 text-xs leading-relaxed text-zinc-400">
                {review.notes}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ActionChip({ action }: { action: "accept" | "edit" | "reject" }) {
  const map: Record<"accept" | "edit" | "reject", { label: string; className: string }> = {
    accept: {
      label: "accepted",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    },
    edit: {
      label: "edited label",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    },
    reject: {
      label: "rejected",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    },
  };
  const m = map[action];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        m.className
      )}
    >
      {m.label}
    </span>
  );
}

/** Accept / edit-label / reject-to-unverified controls (round 1 or senior round 2). */
function ReviewControls({
  verdict,
  analysisId,
  heading,
}: {
  verdict: VerdictDTO;
  analysisId: string;
  heading?: string;
}) {
  const { toast } = useToast();
  const invalidate = useAnalysisInvalidation(analysisId);
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const [selectedLabel, setSelectedLabel] = useState<VerdictLabel | "">("");
  const [notes, setNotes] = useState("");

  const reviewMutation = useMutation({
    mutationFn: submitReview,
    onSuccess: (result, variables) => {
      invalidate();
      setMode("idle");
      setSelectedLabel("");
      setNotes("");
      if (result.needsSecondReview) {
        toast({
          title: "High-impact: awaiting mandatory senior second review",
          description:
            "Your review is recorded. A senior reviewer must countersign before this analysis is marked reviewed (BR-12).",
        });
      } else {
        toast({
          title:
            variables.action === "accept"
              ? "Recommendation accepted — human verdict recorded"
              : variables.action === "edit"
                ? "Label corrected — human verdict recorded"
                : "Recommendation rejected — recorded as Unverified",
          description: "The reviewer decision is final and overrides the model (BR-11).",
        });
      }
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Could not record the review",
        description: err.message,
      });
    },
  });

  const pending = reviewMutation.isPending;

  function submit(action: "accept" | "edit" | "reject"): void {
    reviewMutation.mutate({
      verdictId: verdict.id,
      action,
      finalLabel: action === "edit" && selectedLabel ? selectedLabel : undefined,
      notes: action === "reject" ? notes.trim() : undefined,
    });
  }

  return (
    <div className="space-y-3">
      {heading && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
          <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
          {heading}
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => submit("accept")}
            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            Accept
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setMode("edit")}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          >
            <PenLine className="size-3.5" aria-hidden />
            Edit label
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setMode("reject")}
            className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <X className="size-3.5" aria-hidden />
            Reject to Unverified
          </Button>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <Label htmlFor={`edit-label-${verdict.id}`} className="text-[11px] text-zinc-400">
            Corrected label — required
          </Label>
          <Select value={selectedLabel} onValueChange={(v) => setSelectedLabel(v as VerdictLabel)}>
            <SelectTrigger
              id={`edit-label-${verdict.id}`}
              className="h-9 w-full border-zinc-800 bg-zinc-900/60 text-zinc-200 sm:w-72"
            >
              <SelectValue placeholder="Choose the correct label…" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {ALL_LABELS.map((label) => (
                <SelectItem key={label} value={label}>
                  {LABEL_META[label].display}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!selectedLabel || pending} onClick={() => submit("edit")}>
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              Confirm edit
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2.5 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
          <Label htmlFor={`reject-notes-${verdict.id}`} className="text-[11px] text-zinc-400">
            Reason for rejecting — required, kept in the audit trail
          </Label>
          <Textarea
            id={`reject-notes-${verdict.id}`}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why should this recommendation not stand? The claim will be recorded as Unverified."
            className="min-h-20 border-zinc-800 bg-zinc-900/60 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-rose-500/30"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={notes.trim().length === 0 || pending}
              onClick={() => submit("reject")}
              className="bg-rose-500/90 text-white hover:bg-rose-500"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="size-3.5" aria-hidden />
              )}
              Confirm rejection
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Appeal & feedback (collapsible) ─────────────────── */

function AppealForm({
  verdictId,
  analysisId,
  defaultName,
  defaultEmail,
}: {
  verdictId: string;
  analysisId: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const { toast } = useToast();
  const invalidate = useAnalysisInvalidation(analysisId);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [reason, setReason] = useState("");
  const [filed, setFiled] = useState(false);

  const appealMutation = useMutation({
    mutationFn: fileAppeal,
    onSuccess: () => {
      setFiled(true);
      invalidate();
      toast({
        title: "Appeal filed (BR-14)",
        description: "Appeal filed — tracked in the Appeals view. A senior reviewer will resolve it.",
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Could not file the appeal",
        description: err.message,
      });
    },
  });

  if (filed) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-teal-500/25 bg-teal-500/5 px-3.5 py-2.5 text-xs text-teal-300">
        <Check className="size-3.5 shrink-0" aria-hidden />
        Appeal filed — tracked in the Appeals view. A senior reviewer will resolve it.
      </p>
    );
  }

  const nameValid = name.trim().length >= 2;
  const reasonValid = reason.trim().length >= 10;
  const pending = appealMutation.isPending;

  return (
    <form
      className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (nameValid && reasonValid && !pending) {
          appealMutation.mutate({
            verdictId,
            appellantName: name.trim(),
            appellantEmail: email.trim() || undefined,
            reason: reason.trim(),
          });
        }
      }}
    >
      <div>
        <h5 className="text-xs font-semibold text-zinc-200">
          File an appeal{" "}
          <span className="font-normal text-zinc-500">(BR-14 — open to any labelled party)</span>
        </h5>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
          Disagree with this verdict? Appeals are resolved by a senior reviewer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`appeal-name-${verdictId}`} className="text-[11px] text-zinc-400">
            Appellant name
          </Label>
          <Input
            id={`appeal-name-${verdictId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className="h-8 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`appeal-email-${verdictId}`} className="text-[11px] text-zinc-400">
            Email <span className="text-zinc-600">(optional)</span>
          </Label>
          <Input
            id={`appeal-email-${verdictId}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.org"
            autoComplete="email"
            className="h-8 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`appeal-reason-${verdictId}`} className="text-[11px] text-zinc-400">
          Reason <span className="text-zinc-600">(min 10 characters)</span>
        </Label>
        <Textarea
          id={`appeal-reason-${verdictId}`}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why you believe this verdict is wrong — cite evidence if you can."
          className="min-h-20 border-zinc-800 bg-zinc-900/60 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="submit"
          size="sm"
          disabled={!nameValid || !reasonValid || pending}
          className="bg-amber-500/90 text-zinc-950 hover:bg-amber-400"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <MessageSquareWarning className="size-3.5" aria-hidden />
          )}
          File appeal
        </Button>
        <span className="font-mono text-[10px] text-zinc-600" aria-live="polite">
          reason {reason.trim().length}/10 chars
        </span>
      </div>
    </form>
  );
}

function FeedbackForm({ verdictId }: { verdictId: string }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"idle" | "wrong">("idle");
  const [corrected, setCorrected] = useState<VerdictLabel | "">("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);

  const feedbackMutation = useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      setDone(true);
      toast({
        title: "Feedback recorded as labelled training data",
        description: "Reviewer feedback becomes labelled training data for future releases (BR-15).",
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Could not record feedback",
        description: err.message,
      });
    },
  });

  if (done) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-emerald-400">
        <ThumbsUp className="size-3.5 shrink-0" aria-hidden />
        Feedback recorded as labelled training data — thank you (BR-15).
      </p>
    );
  }

  const pending = feedbackMutation.isPending;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5">
      <div>
        <h5 className="text-xs font-semibold text-zinc-200">
          Reviewer feedback{" "}
          <span className="font-normal text-zinc-500">(BR-15 — labelled training data)</span>
        </h5>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
          Was the model recommendation right? Your answer is stored as labelled training data.
        </p>
      </div>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => feedbackMutation.mutate({ verdictId, agree: true })}
            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ThumbsUp className="size-3.5" aria-hidden />
            )}
            Model was right
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setMode("wrong")}
            className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <ThumbsDown className="size-3.5" aria-hidden />
            Model was wrong
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <Label htmlFor={`fb-label-${verdictId}`} className="text-[11px] text-zinc-400">
            Corrected label — what should it have been?
          </Label>
          <Select value={corrected} onValueChange={(v) => setCorrected(v as VerdictLabel)}>
            <SelectTrigger
              id={`fb-label-${verdictId}`}
              className="h-9 w-full border-zinc-800 bg-zinc-900/60 text-zinc-200 sm:w-72"
            >
              <SelectValue placeholder="Choose the corrected label…" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {ALL_LABELS.map((label) => (
                <SelectItem key={label} value={label}>
                  {LABEL_META[label].display}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            aria-label="Feedback notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional) — what did the model miss?"
            className="min-h-16 border-zinc-800 bg-zinc-900/60 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!corrected || pending}
              onClick={() =>
                feedbackMutation.mutate({
                  verdictId,
                  agree: false,
                  correctedLabel: corrected || undefined,
                  notes: notes.trim() || undefined,
                })
              }
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <ThumbsDown className="size-3.5" aria-hidden />
              )}
              Submit feedback
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Skeletons ─────────────────────────── */

function AnalysisSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6" aria-busy="true" aria-live="polite">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-44 rounded-full" />
          <Skeleton className="h-6 w-36 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-16 w-full" />
        <Skeleton className="mt-3 h-3 w-2/3" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-11/12" />
          <Skeleton className="mt-5 h-24 w-full" />
          <Skeleton className="mt-5 h-36 w-full" />
        </div>
      ))}
    </div>
  );
}
