"use client";
/**
 * ReviewView — the reviewer's triage dashboard (BR-10).
 * Card-based queue (evidence-heavy dossiers don't fit tables) with search,
 * status/verdict filters and pagination. Opening a card opens the analysis
 * dossier, where evidence is always shown before the model verdict.
 * Keyboard-first triage: j/k (or ↑/↓) walk the queue, Enter/o opens.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { BookmarkCheck, Check, ChevronLeft, ChevronRight, Clock, CopyPlus, Eye, FolderSearch, Gavel, Inbox, Layers, MousePointerClick, RotateCw, Search, ShieldAlert, ShieldCheck, Tag, UserRound } from "lucide-react";

import { fetchAnalyses } from "@/lib/api";
import { ALL_LABELS, LABEL_META, REVIEWER_ROLES, ROLE_DISPLAY, SENIOR_ROLES } from "@/lib/taxonomy";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AnalysisDTO } from "@/types/api";
import { StatusBadge, VerdictBadge } from "@/components/verdict/verdict-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const PAGE_SIZE = 12;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending_review", label: "Awaiting review" },
  { value: "in_review", label: "In review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "appealed", label: "Appealed" },
];

/* ── Saved filters (localStorage) ─────────────────────────────────────
 * ReviewView only mounts client-side after the session check, so reading
 * localStorage during the initial render is hydration-safe. Writes happen
 * in a plain effect (storage only — no state set). */
const FILTERS_KEY = "veritas-review-filters";

interface SavedFilters {
  search: string;
  status: string;
  label: string;
  highImpactOnly: boolean;
}

const DEFAULT_FILTERS: SavedFilters = {
  search: "",
  status: "all",
  label: "all",
  highImpactOnly: false,
};

function loadSavedFilters(): SavedFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_FILTERS;
    const p = parsed as Partial<Record<keyof SavedFilters, unknown>>;
    return {
      search: typeof p.search === "string" ? p.search.slice(0, 200) : "",
      status:
        typeof p.status === "string" && STATUS_OPTIONS.some((o) => o.value === p.status)
          ? p.status
          : "all",
      label: typeof p.label === "string" && ALL_LABELS.includes(p.label as never) ? p.label : "all",
      highImpactOnly: p.highImpactOnly === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(filters: SavedFilters): void {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    /* storage unavailable (private mode/quota) — persistence is best-effort */
  }
}

export function ReviewView() {
  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const reviewPreset = useAppStore((s) => s.reviewPreset);
  const setReviewPreset = useAppStore((s) => s.setReviewPreset);
  const { data: session } = useSession();
  const user = session?.user as { name?: string | null; role?: string } | undefined;
  const role = user?.role ?? "viewer";
  const isReviewer = REVIEWER_ROLES.includes(role);
  const isSenior = SENIOR_ROLES.includes(role);

  // restored once on mount (client-only component — hydration-safe); a
  // one-shot cross-view preset (analytics KPI drills) takes priority so the
  // queue opens with the drill's filter already applied
  const [saved] = useState(loadSavedFilters);
  const [search, setSearch] = useState(saved.search);
  const [debounced, setDebounced] = useState(saved.search.trim());
  const [status, setStatus] = useState(
    reviewPreset?.status && STATUS_OPTIONS.some((o) => o.value === reviewPreset.status)
      ? reviewPreset.status
      : saved.status
  );
  const [label, setLabel] = useState(
    reviewPreset?.label && ALL_LABELS.includes(reviewPreset.label as never)
      ? reviewPreset.label
      : saved.label
  );
  const [highImpactOnly, setHighImpactOnly] = useState(saved.highImpactOnly);
  const [page, setPage] = useState(1);
  /** keyboard-selected row (j/k) — null until the first keypress */
  const [selected, setSelected] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // consume the one-shot preset after initial render (store write only)
  useEffect(() => {
    if (reviewPreset) setReviewPreset(null);
  }, [reviewPreset, setReviewPreset]);

  // debounce the search box (~300ms); typing always restarts pagination
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // persist the active filter set (storage write only — never sets state)
  useEffect(() => {
    saveFilters({ search, status, label, highImpactOnly });
  }, [search, status, label, highImpactOnly]);

  const filters = useMemo(
    () => ({
      status: status === "all" ? undefined : status,
      label: label === "all" ? undefined : label,
      q: debounced || undefined,
      highImpact: highImpactOnly ? "true" : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [status, label, debounced, highImpactOnly, page]
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["analyses", filters],
    queryFn: () => fetchAnalyses(filters),
    placeholderData: (previous) => previous,
  });

  const analyses = data?.analyses ?? [];
  const total = data?.total ?? 0;

  /* j/k/Enter keyboard triage — enabled once rows are on screen. Selection
   * is an index into the current page; any filter/page change clamps it. */
  const clampedSelected =
    selected === null ? null : Math.min(selected, Math.max(0, analyses.length - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") {
        if (analyses.length === 0) return;
        event.preventDefault();
        setSelected((prev) => {
          const next = prev === null ? 0 : Math.min(prev + 1, analyses.length - 1);
          cardRefs.current[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return next;
        });
      } else if (key === "k" || event.key === "ArrowUp") {
        if (analyses.length === 0) return;
        event.preventDefault();
        setSelected((prev) => {
          const next = prev === null ? analyses.length - 1 : Math.max(prev - 1, 0);
          cardRefs.current[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return next;
        });
      } else if (key === "enter" || key === "o") {
        if (clampedSelected === null) return;
        // if an actual button is focused, let its native click open instead
        if (target instanceof HTMLElement && target.tagName === "BUTTON") return;
        event.preventDefault();
        const analysis = analyses[clampedSelected];
        if (analysis) openAnalysis(analysis.id);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analyses, clampedSelected, openAnalysis]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Derive the effective page (clamped) so a shrinking result set can never
  // strand the user on an out-of-range page. If the raw page is out of range,
  // adjust it during render (React-documented pattern) — the query key change
  // then refetches the in-range page. No state-setting effects needed.
  const currentPage = Math.min(page, totalPages);
  if (page !== currentPage) {
    setPage(currentPage);
  }

  const hasActiveFilters = debounced !== "" || status !== "all" || label !== "all" || highImpactOnly;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
      {/* header */}
      <header className="pt-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Review queue</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-400">
          Recommendations await human confirmation. Evidence is always shown before the
          model verdict.
        </p>
        {/* role-aware summary chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400">
            <UserRound className="size-3 text-zinc-500" aria-hidden />
            Signed in as {ROLE_DISPLAY[role] ?? role}
          </span>
          {isSenior ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
              <ShieldCheck className="size-3" aria-hidden />
              You clear high-impact second reviews (BR-12)
            </span>
          ) : isReviewer ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
              <Gavel className="size-3" aria-hidden />
              You confirm or override verdicts (BR-11)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400">
              <Eye className="size-3" aria-hidden />
              Read-only — a reviewer account is required to confirm verdicts
            </span>
          )}
        </div>
      </header>

      {/* sticky filter bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-zinc-800/70 bg-zinc-950/90 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search claim text…"
              aria-label="Search claim text"
              className="h-8 border-zinc-800 bg-zinc-900/60 pl-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
            />
          </div>

          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger
              size="sm"
              aria-label="Filter by status"
              className="w-[150px] border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={label} onValueChange={(v) => { setLabel(v); setPage(1); }}>
            <SelectTrigger
              size="sm"
              aria-label="Filter by verdict label"
              className="w-[160px] border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300"
            >
              <SelectValue placeholder="Verdict" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              <SelectItem value="all">All verdicts</SelectItem>
              {ALL_LABELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {LABEL_META[l].short}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={() => {
              setHighImpactOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={highImpactOnly}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
              highImpactOnly
                ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            )}
          >
            <ShieldAlert className="size-3.5" aria-hidden />
            High-impact only
          </button>

          <span
            className={cn(
              "ml-auto font-mono text-[11px] tabular-nums text-zinc-500",
              isFetching && "animate-pulse"
            )}
            aria-live="polite"
          >
            {total} {total === 1 ? "analysis" : "analyses"}
          </span>

          {hasActiveFilters && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-400/90">
                  <BookmarkCheck className="size-3" aria-hidden />
                  saved
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="border border-zinc-800 bg-zinc-900 text-zinc-300">
                Filters persist across sessions on this device — reviewers keep their
                triage context between visits.
              </TooltipContent>
            </Tooltip>
          )}

          {/* keyboard triage hint — hidden on touch-sized screens */}
          <span className="ml-1 hidden items-center gap-1.5 text-[11px] text-zinc-600 md:inline-flex" aria-hidden>
            <MousePointerClick className="size-3" />
            <kbd className="veritas-kbd">j</kbd>
            <kbd className="veritas-kbd">k</kbd>
            select
            <kbd className="veritas-kbd">↵</kbd>
            open
          </span>
        </div>
      </div>

      {/* queue list */}
      <div className="space-y-3" aria-busy={isFetching}>
        {isLoading ? (
          <>
            <QueueCardSkeleton />
            <QueueCardSkeleton />
            <QueueCardSkeleton />
          </>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 py-12">
            <p className="text-sm text-zinc-300">
              Couldn&apos;t load the queue
              {error instanceof Error ? ` — ${error.message}` : ""}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RotateCw /> Retry
            </Button>
          </div>
        ) : analyses.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-800 py-16"
          >
            <span className="flex size-12 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
              <Inbox className="size-5 text-emerald-400" aria-hidden />
            </span>
            <p className="text-sm font-medium text-zinc-300">Queue is clear</p>
            <p className="max-w-sm text-center text-xs text-zinc-500">
              No analyses match the current filters — every human decision is logged in the audit
              trail and every pending item got its verdict.
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setLabel("all");
                  setHighImpactOnly(false);
                  setPage(1);
                  saveFilters(DEFAULT_FILTERS);
                }}
              >
                <RotateCw /> Clear filters
              </Button>
            )}
          </motion.div>
        ) : (
          analyses.map((analysis, index) => (
            <QueueCard
              key={analysis.id}
              analysis={analysis}
              index={index}
              selected={clampedSelected === index}
              cardRef={(el) => {
                cardRefs.current[index] = el;
              }}
              onOpen={() => openAnalysis(analysis.id)}
            />
          ))
        )}
      </div>

      {/* pagination */}
      {total > PAGE_SIZE && (
        <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Pagination">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1 || isFetching}
            onClick={() => setPage(Math.max(1, currentPage - 1))}
          >
            <ChevronLeft /> Prev
          </Button>
          <span className="font-mono text-[11px] tabular-nums text-zinc-500" aria-live="polite">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages || isFetching}
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          >
            Next <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}

/* ─────────────────────────── Queue card ─────────────────────────── */

/** Status-coloured left accent — triage state readable at a glance. */
const STATUS_ACCENT: Record<string, string> = {
  pending_review: "bg-amber-400/70",
  in_review: "bg-teal-400/70",
  reviewed: "bg-emerald-400/70",
  appealed: "bg-rose-400/70",
};

function QueueCard({
  analysis,
  index,
  selected,
  cardRef,
  onOpen,
}: {
  analysis: AnalysisDTO;
  index: number;
  selected: boolean;
  cardRef: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const claims = analysis.claims;
  const assessableCount = claims.filter((c) => c.assessable).length;
  const evidenceCount = claims.reduce((sum, c) => sum + (c.verdict?.evidence.length ?? 0), 0);
  const reviewCount = claims.reduce((sum, c) => sum + (c.verdict?.reviews.length ?? 0), 0);
  const accent = STATUS_ACCENT[analysis.status] ?? "bg-zinc-600";

  return (
    <motion.button
      ref={cardRef}
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      className={cn(
        "group relative block w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 pl-5 text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-900/70 hover:shadow-lg hover:shadow-black/20",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60",
        "active:scale-[0.995]",
        selected && "border-emerald-500/60 bg-zinc-900/75 ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-950/30"
      )}
      aria-label={`Open analysis: ${analysis.inputText.slice(0, 80)}`}
      aria-current={selected ? "true" : undefined}
    >
      {/* status accent bar */}
      <span
        aria-hidden
        className={`absolute inset-y-2 left-0 w-1 rounded-full ${accent}`}
      />
      {/* row 1 — status chips */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={analysis.status} />
        <VerdictBadge label={analysis.overallLabel} size="sm" />
        {analysis.highImpact && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            <ShieldAlert className="size-3" aria-hidden />
            High-impact
          </span>
        )}
        {analysis.duplicateOfId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-300">
                <CopyPlus className="size-3" aria-hidden />
                BR-08 reuse
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-60 border border-zinc-800 bg-zinc-900 text-left text-zinc-300">
              Near-duplicate of analysis #{analysis.duplicateOfId.slice(0, 8)} — the stored
              human ruling was reused instead of issuing a fresh model verdict.
            </TooltipContent>
          </Tooltip>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {typeof analysis.latencyMs === "number" && (
            <span
              className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-400"
              title="Engine latency"
            >
              {analysis.latencyMs}ms
            </span>
          )}
          <time
            dateTime={analysis.createdAt}
            className="whitespace-nowrap font-mono text-[11px] text-zinc-500"
          >
            {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
          </time>
        </span>
      </div>

      {/* row 2 — input text */}
      <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-zinc-300">
        {analysis.inputText}
      </p>

      {/* row 3 — meta strip */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Layers className="size-3" aria-hidden />
          {claims.length} {claims.length === 1 ? "claim" : "claims"} · {assessableCount}{" "}
          assessable
        </span>
        <span className="inline-flex items-center gap-1">
          <FolderSearch className="size-3" aria-hidden />
          {evidenceCount} citations
        </span>
        {reviewCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-400/90">
            <Check className="size-3" aria-hidden />
            {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            awaiting first review
          </span>
        )}
        {analysis.topic && (
          <span className="inline-flex items-center gap-1 uppercase tracking-wide">
            <Tag className="size-3" aria-hidden />
            {analysis.topic}
          </span>
        )}
      </div>

      <ChevronRight
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 text-zinc-600 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-400 group-hover:opacity-100 sm:block"
        aria-hidden
      />
    </motion.button>
  );
}

/* ─────────────────────────── Skeletons ─────────────────────────── */

function QueueCardSkeleton() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4" aria-hidden>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="ml-auto h-4 w-20" />
      </div>
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-1.5 h-4 w-2/3" />
      <div className="mt-3 flex gap-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}
