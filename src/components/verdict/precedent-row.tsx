"use client";
/**
 * PrecedentRow — one similar previously human-reviewed claim.
 *
 * Shared by the dossier Precedent panel and the global precedent-search
 * dialog, so both surfaces stay visually identical. Advisory only: clicking
 * opens the source dossier for the reviewer's own judgement.
 */
import { formatDistanceToNow } from "date-fns";
import { VerdictBadge } from "@/components/verdict/verdict-badge";
import type { SimilarClaimDTO } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PrecedentRow({
  match,
  onOpen,
}: {
  match: SimilarClaimDTO;
  onOpen: (analysisId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(match.analysisId)}
      className="group flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 sm:flex-row sm:items-center sm:gap-4"
      aria-label={`Open precedent dossier — ${Math.round(match.similarity * 100)}% similar, ruled ${match.finalLabel}`}
    >
      <span className="flex w-full shrink-0 items-center gap-2 sm:w-28 sm:flex-col sm:items-start sm:gap-1">
        <span className="font-mono text-sm font-semibold tabular-nums text-amber-200">
          {Math.round(match.similarity * 100)}%
          <span className="ml-1 text-[10px] font-normal text-zinc-500">sim.</span>
        </span>
        <span
          className="h-1 w-full max-w-24 overflow-hidden rounded-full bg-zinc-800/90"
          role="meter"
          aria-valuenow={Math.round(match.similarity * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Similarity ${Math.round(match.similarity * 100)}%`}
        >
          <span
            className={cn(
              "block h-full rounded-full transition-all",
              match.similarity >= 0.6
                ? "bg-amber-400/90"
                : match.similarity >= 0.4
                  ? "bg-amber-500/60"
                  : "bg-zinc-500"
            )}
            style={{ width: `${Math.max(4, Math.round(match.similarity * 100))}%` }}
          />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-relaxed text-zinc-300 transition-colors group-hover:text-zinc-100">
          {match.text}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
          <span>ruled</span>
          <VerdictBadge label={match.finalLabel} size="sm" />
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">
            {match.reviewerName ? `by ${match.reviewerName}` : "by a reviewer"}{" "}
            {formatDistanceToNow(new Date(match.reviewedAt), { addSuffix: true })}
          </span>
        </span>
      </span>
      <span className="hidden shrink-0 text-[11px] font-medium text-zinc-600 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-400 group-hover:opacity-100 sm:block">
        Open dossier →
      </span>
    </button>
  );
}
