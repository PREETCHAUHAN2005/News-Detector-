"use client";
/** Cited evidence list (BR-03): retrieved fact-checks with similarity,
    rating and source link. Rendered BEFORE the model verdict in the
    analysis view (anti-automation-bias, BRD §12). Each card cross-references
    the trusted-source registry to show the evidence domain's reliability.
    Excerpts highlight the claim terms that drove retrieval (engine TF-IDF
    vocabulary; lexical fallback for legacy rows) — evidence-first, explained. */
import { useMemo, useState } from "react";
import { BadgeCheck, Check, Copy, ExternalLink, Highlighter, Quote, ShieldCheck, UserRound } from "lucide-react";
import type { EvidenceDTO } from "@/types/api";
import {
  effectiveHighlightDetails,
  normalizeHighlightDetails,
  segmentHighlighted,
  type HighlightDetail,
} from "@/lib/highlight";
import { cn } from "@/lib/utils";

const RATING_STYLE: Record<string, string> = {
  true: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  "mostly-true": "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  "half-true": "text-amber-400 border-amber-500/40 bg-amber-500/10",
  "barely-true": "text-orange-400 border-orange-500/40 bg-orange-500/10",
  false: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  "pants-fire": "text-rose-400 border-rose-500/40 bg-rose-500/10",
};

/** Rating-coloured left accent for evidence cards — verdict tone readable at a glance. */
const RATING_ACCENT: Record<string, string> = {
  true: "border-l-emerald-400/70",
  "mostly-true": "border-l-emerald-400/70",
  "half-true": "border-l-amber-400/70",
  "barely-true": "border-l-orange-400/70",
  false: "border-l-rose-400/70",
  "pants-fire": "border-l-rose-400/70",
};

const RATING_LABEL: Record<string, string> = {
  true: "True",
  "mostly-true": "Mostly True",
  "half-true": "Half True",
  "barely-true": "Mostly False",
  false: "False",
  "pants-fire": "Pants on Fire",
};

/** Copy a formatted, citation-ready reference for one evidence row. */
function citationText(evidence: EvidenceDTO): string {
  const rating = RATING_LABEL[evidence.kbRating] ?? evidence.kbRating;
  const parts = [
    `"${evidence.excerpt}"`,
    `— PolitiFact ruling: ${rating}`,
    evidence.speaker ? `speaker: ${evidence.speaker}` : null,
    evidence.context ? `context: ${evidence.context}` : null,
    `${Math.round(evidence.similarity * 100)}% match`,
    evidence.url,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ");
}

/** Reliability tier styling for the trusted-source chip. */
function reliabilityTier(score: number): { className: string; label: string } {
  if (score >= 0.9)
    return { className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", label: "high" };
  if (score >= 0.75)
    return { className: "border-teal-500/40 bg-teal-500/10 text-teal-300", label: "strong" };
  if (score >= 0.5)
    return { className: "border-amber-500/40 bg-amber-500/10 text-amber-400", label: "moderate" };
  return { className: "border-zinc-700 bg-zinc-800/60 text-zinc-400", label: "low" };
}

/** Trusted-source chip (BR-03): evidence domain + registry reliability. */
function SourceChip({ source }: { source: NonNullable<EvidenceDTO["source"]> }) {
  const score = typeof source.reliabilityScore === "number" ? source.reliabilityScore : null;
  const tier = score !== null ? reliabilityTier(score) : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/50 px-2 py-0.5 text-[11px] text-zinc-400"
      title={`Trusted-source registry (BR-03): ${source.name ?? "source"}${score !== null ? ` — reliability ${Math.round(score * 100)}%` : ""}${source.category ? ` · category: ${source.category}` : ""}`}
    >
      <ShieldCheck className="size-3 text-emerald-400/90" aria-hidden />
      <span className="font-mono">{source.domain ?? source.name ?? "source"}</span>
      {tier && score !== null && (
        <span
          className={cn("rounded-full border px-1.5 py-px text-[10px] font-medium", tier.className)}
          title={`${tier.label} reliability tier`}
        >
          {Math.round(score * 100)}% rel.
        </span>
      )}
    </span>
  );
}

/** Format one weighted term as a compact mono chip (top terms row). */
function TermChip({ detail, rank }: { detail: HighlightDetail; rank: number }) {
  const weight = detail.idf;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0.5 font-mono text-[10px] leading-none text-emerald-200/90"
      title={
        weight !== undefined
          ? `"${detail.term}" — IDF ${weight.toFixed(2)} · retrieval driver #${rank}`
          : `"${detail.term}" — lexical overlap (legacy row)`
      }
    >
      {detail.term}
      {weight !== undefined && (
        <span className="text-[9px] font-semibold leading-none text-emerald-400/80 tabular-nums">
          {weight.toFixed(1)}
        </span>
      )}
    </span>
  );
}

export function EvidenceCard({
  evidence,
  claimText,
  compact = false,
}: {
  evidence: EvidenceDTO;
  /** current claim text — enables the lexical fallback + makes highlights verifiable */
  claimText?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const highlightDetails = useMemo(
    () =>
      claimText
        ? effectiveHighlightDetails(evidence.highlights, claimText, evidence.excerpt)
        : [],
    [evidence.highlights, evidence.excerpt, claimText]
  );
  const excerptSegments = useMemo(
    () => segmentHighlighted(evidence.excerpt, highlightDetails),
    [evidence.excerpt, highlightDetails]
  );
  const usedStored =
    highlightDetails.length > 0 && normalizeHighlightDetails(evidence.highlights).length > 0;
  const hasWeights = highlightDetails.some((d) => d.idf !== undefined);
  const topTerms = highlightDetails.slice(0, 4);

  async function copyCitation(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    // the overlay button sits above the anchor card — keep the click local
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(citationText(evidence));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (permissions / non-secure ctx) — silently skip */
    }
  }

  return (
    <div className="group relative">
      <a
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "block rounded-lg border border-zinc-800 border-l-2 bg-zinc-900/70 p-3.5 pl-4 transition-all duration-200",
          "hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900/90 hover:shadow-lg hover:shadow-black/25",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 active:translate-y-0 active:scale-[0.99]",
          RATING_ACCENT[evidence.kbRating] ?? "border-l-zinc-600",
          compact && "p-3"
        )}
        aria-label={`Evidence ${evidence.rank}: ${evidence.title}`}
      >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            #{evidence.rank}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              RATING_STYLE[evidence.kbRating] ?? "border-zinc-700 bg-zinc-800 text-zinc-300"
            )}
          >
            {RATING_LABEL[evidence.kbRating] ?? evidence.kbRating}
          </span>
          <span className="font-mono text-[11px] font-medium tabular-nums text-zinc-400">
            {Math.round(evidence.similarity * 100)}% match
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {/* spacer reserves the overlay copy-button's slot (layout stability) */}
          <span className="inline-block size-6" aria-hidden />
          <ExternalLink
            className="size-3.5 text-zinc-600 transition-colors group-hover:text-emerald-400"
            aria-hidden
          />
        </span>
      </div>
      {/* similarity meter — visualizes retrieval strength at a glance */}
      <div
        className="mb-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800/80"
        role="meter"
        aria-valuenow={Math.round(evidence.similarity * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Retrieval similarity ${Math.round(evidence.similarity * 100)}%`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            evidence.similarity >= 0.8
              ? "bg-emerald-500/80"
              : evidence.similarity >= 0.6
                ? "bg-amber-500/80"
                : "bg-zinc-600"
          )}
          style={{ width: `${Math.max(4, Math.round(evidence.similarity * 100))}%` }}
        />
      </div>
      <p className={cn("text-[13px] leading-relaxed text-zinc-200", compact && "line-clamp-2 text-xs")}>
        <Quote className="mr-1.5 inline size-3 -translate-y-px text-emerald-400/50" aria-hidden />
        {excerptSegments.map((seg, i) =>
          seg.match ? (
            <mark
              key={i}
              title={
                seg.idf !== undefined
                  ? `“${seg.term}” — TF-IDF retrieval driver (IDF ${seg.idf.toFixed(2)}, rank #${
                      highlightDetails.findIndex((d) => d.term === seg.term) + 1
                    } of ${highlightDetails.length})`
                  : `“${seg.term}” — claim term that drove this retrieval (lexical match)`
              }
              className="cursor-help rounded-[3px] bg-emerald-500/15 px-0.5 font-medium text-emerald-200 underline-offset-2 transition-colors hover:bg-emerald-500/30 hover:text-emerald-100"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
      {highlightDetails.length > 0 && !compact && (
        <div className="mt-1.5 space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Highlighter className="size-3 shrink-0 text-emerald-400/70" aria-hidden />
            <span className="truncate">
              {highlightDetails.length} matched claim{" "}
              {highlightDetails.length === 1 ? "term" : "terms"}
              <span className="text-zinc-600">
                {" "}
                ·{" "}
                {usedStored
                  ? hasWeights
                    ? "engine TF-IDF · ranked by IDF weight"
                    : "engine TF-IDF match"
                  : "lexical overlap"}
              </span>
            </span>
          </p>
          {topTerms.length > 0 && (
            <p className="flex flex-wrap items-center gap-1" aria-label="Top matched terms by retrieval weight">
              {topTerms.map((d, i) => (
                <TermChip key={d.term} detail={d} rank={i + 1} />
              ))}
              {highlightDetails.length > topTerms.length && (
                <span className="font-mono text-[10px] text-zinc-600">
                  +{highlightDetails.length - topTerms.length} more
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {(evidence.speaker || evidence.context) && !compact && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {evidence.speaker && (
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3" aria-hidden />
              {evidence.speaker}
            </span>
          )}
          {evidence.context && <span className="italic">{evidence.context}</span>}
        </p>
      )}
      {/* trusted-source cross-reference (BR-03) — registry reliability of the evidence domain */}
      {evidence.source && !compact && (
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <SourceChip source={evidence.source} />
          {evidence.source.approved && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400/80">
              <BadgeCheck className="size-3" aria-hidden />
              approved source
            </span>
          )}
        </p>
      )}
      </a>
      {/* copy citation — overlay sibling (valid HTML: never a button inside the anchor) */}
      <button
        type="button"
        onClick={(e) => void copyCitation(e)}
        title="Copy citation"
        aria-label={`Copy citation for evidence ${evidence.rank}`}
        className="absolute right-2.5 top-2.5 z-10 rounded p-1 text-zinc-600 opacity-0 transition-all hover:bg-zinc-800 hover:text-emerald-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 group-hover:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-400" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

export function EvidenceList({
  evidence,
  claimText,
  compact = false,
}: {
  evidence: EvidenceDTO[];
  claimText?: string;
  compact?: boolean;
}) {
  if (evidence.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
        No evidence above the citation floor was found for this claim — no verdict can be
        responsibly issued (evidence-first policy, BR-05).
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {evidence.map((e) => (
        <EvidenceCard key={e.id ?? e.rank} evidence={e} claimText={claimText} compact={compact} />
      ))}
      <p className="text-[11px] text-zinc-600">
        Sources: trusted-source registry (PolitiFact via LIAR corpus). Similarity is TF-IDF
        cosine across word + character channels. Highlighted terms are claim∩statement
        vocabulary matches that drove retrieval.
      </p>
    </div>
  );
}
