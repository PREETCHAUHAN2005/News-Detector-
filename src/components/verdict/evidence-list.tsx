"use client";
/** Cited evidence list (BR-03): retrieved fact-checks with similarity,
    rating and source link. Rendered BEFORE the model verdict in the
    analysis view (anti-automation-bias, BRD §12). */
import { ExternalLink, Quote, UserRound } from "lucide-react";
import type { EvidenceDTO } from "@/types/api";
import { cn } from "@/lib/utils";

const RATING_STYLE: Record<string, string> = {
  true: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  "mostly-true": "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  "half-true": "text-amber-400 border-amber-500/40 bg-amber-500/10",
  "barely-true": "text-orange-400 border-orange-500/40 bg-orange-500/10",
  false: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  "pants-fire": "text-rose-400 border-rose-500/40 bg-rose-500/10",
};

const RATING_LABEL: Record<string, string> = {
  true: "True",
  "mostly-true": "Mostly True",
  "half-true": "Half True",
  "barely-true": "Mostly False",
  false: "False",
  "pants-fire": "Pants on Fire",
};

export function EvidenceCard({
  evidence,
  compact = false,
}: {
  evidence: EvidenceDTO;
  compact?: boolean;
}) {
  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900/70",
        compact && "p-3"
      )}
      aria-label={`Evidence ${evidence.rank}: ${evidence.title}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
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
          <span className="font-mono text-[11px] text-zinc-500">
            {Math.round(evidence.similarity * 100)}% match
          </span>
        </div>
        <ExternalLink className="size-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-400" aria-hidden />
      </div>
      <p className={cn("text-[13px] leading-relaxed text-zinc-200", compact && "line-clamp-2 text-xs")}>
        <Quote className="mr-1 inline size-3 text-zinc-600" aria-hidden />
        {evidence.excerpt}
      </p>
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
    </a>
  );
}

export function EvidenceList({
  evidence,
  compact = false,
}: {
  evidence: EvidenceDTO[];
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
        <EvidenceCard key={e.id ?? e.rank} evidence={e} compact={compact} />
      ))}
      <p className="text-[11px] text-zinc-600">
        Sources: trusted-source registry (PolitiFact via LIAR corpus). Similarity is TF-IDF
        cosine across word + character channels.
      </p>
    </div>
  );
}
