"use client";
/**
 * Operations analytics (BR-16/17) — volume, verdict mix, abstention,
 * overrides, latency percentiles and fairness-by-topic surfacing with
 * drill-down from any topic bar into the underlying analyses (BR-17).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Clock,
  Download,
  FileSearch,
  Gauge,
  HelpCircle,
  ListFilter,
  Loader2,
  RotateCcw,
  ScrollText,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchAnalyses, fetchAnalytics } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { ALL_LABELS, LABEL_META, TAXONOMY } from "@/lib/taxonomy";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { AnalysisDTO, AnalyticsDTO } from "@/types/api";
import { StatusBadge, VerdictBadge } from "@/components/verdict/verdict-badge";

/** Hex palette mirroring LABEL_META (no blue/purple). */
const LABEL_HEX: Record<string, string> = {
  [TAXONOMY.SUPPORTED]: "#34d399",
  [TAXONOMY.CONTRADICTED]: "#fb7185",
  [TAXONOMY.MISLEADING]: "#fbbf24",
  [TAXONOMY.UNVERIFIED]: "#a1a1aa",
  [TAXONOMY.NOT_ASSESSABLE]: "#5eead4",
};

const REVIEW_ACTION_HEX: Record<string, string> = {
  accept: "#34d399",
  edit: "#fbbf24",
  reject: "#fb7185",
};

function fmtPercent(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Allowed date-range windows (mirrors the API). */
const RANGE_OPTIONS = [7, 30, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

/** Aggregate daily rows into weekly buckets for the wider windows. */
function bucketWeekly(
  daily: { date: string; total: number; contradicted: number }[]
): { date: string; total: number; contradicted: number }[] {
  const weeks = new Map<string, { total: number; contradicted: number }>();
  for (const day of daily) {
    const d = new Date(`${day.date}T00:00:00`);
    // Monday-based week start
    const weekday = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - weekday);
    const key = monday.toISOString().slice(0, 10);
    const entry = weeks.get(key) ?? { total: 0, contradicted: 0 };
    entry.total += day.total;
    entry.contradicted += day.contradicted;
    weeks.set(key, entry);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}

/* ── KPI sparkline + delta chip ────────────────────────────────────── */

/** Inline SVG trend line for KPI tiles (no chart lib overhead). */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 24;
  const pad = 2;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const [lastX, lastY] = points[points.length - 1];
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "#34d399" : "#fb7185";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className={className}
      role="img"
      aria-label={`Daily volume trend: ${min} to ${max} per day over the window`}
    >
      <polygon points={area} fill={stroke} opacity={0.08} />
      {/* faint baseline so the micro-trend has a floor reference */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#3f3f46" strokeWidth={0.5} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.2} fill={stroke} />
    </svg>
  );
}

interface KpiDelta {
  current: number;
  previous: number;
  /** relative fraction for counts/latency, absolute percentage points for rates */
  delta: number | null;
  /** how the delta value is formatted */
  kind: "count" | "rate" | "ms";
  /** which direction is desirable — "none" renders neutral zinc */
  good: "up" | "down" | "none";
}

/** Period-over-period change chip under the KPI value. */
function DeltaChip({ delta, days }: { delta: KpiDelta; days: number }) {
  if (delta.delta === null) {
    // previous window was empty — nothing comparable yet
    return delta.previous === 0 && delta.current > 0 ? (
      <p className="mt-1 font-mono text-[10px] text-zinc-600">new in this window</p>
    ) : null;
  }
  const pct = delta.delta;
  if (pct === 0) {
    return (
      <p className="mt-1 font-mono text-[10px] text-zinc-600">flat vs prev {days}d</p>
    );
  }
  const up = pct > 0;
  const good =
    delta.good === "none" ? null : (up && delta.good === "up") || (!up && delta.good === "down");
  const cls =
    good === null
      ? "text-zinc-300"
      : good
        ? "text-emerald-300"
        : "text-rose-300";
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const magnitude =
    delta.kind === "rate"
      ? `${up ? "+" : "−"}${Math.abs(pct * 100).toFixed(1)}pp`
      : `${up ? "+" : "−"}${Math.abs(Math.round(pct * 100))}%`;
  return (
    <p className={cn("mt-1 flex items-center gap-1 font-mono text-[10px] tabular-nums", cls)}>
      <TrendIcon className="size-3" aria-hidden />
      {magnitude}
      <span className="font-sans text-zinc-600">vs prev {days}d</span>
    </p>
  );
}

/* ── KPI tile ──────────────────────────────────────────────────────── */

function KpiTile({
  icon: Icon,
  value,
  label,
  tip,
  accent = "text-zinc-500",
  delta,
  sparkline,
  days,
  onDrill,
  drillHint,
  onDrillSecondary,
  drillHintSecondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  tip?: string;
  accent?: string;
  delta?: KpiDelta;
  sparkline?: number[];
  days?: number;
  /** drill-down action — renders an affordance button on the tile */
  onDrill?: () => void;
  drillHint?: string;
  /** optional second drill (e.g. cross-view with pre-applied filters) */
  onDrillSecondary?: () => void;
  drillHintSecondary?: string;
}) {
  const tipWithPrev =
    tip && delta ? `${tip} · previous ${days}d: ${delta.previous.toLocaleString()}` : tip;
  return (
    <Card className="group border-zinc-800 bg-zinc-900/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
          <Icon className={`size-3.5 shrink-0 ${accent}`} aria-hidden />
          <span className="leading-tight">{label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {onDrillSecondary && (
              <button
                type="button"
                onClick={onDrillSecondary}
                title={drillHintSecondary ?? "Drill down with filters"}
                aria-label={drillHintSecondary ?? `Open ${label} in the review queue`}
                className="rounded p-0.5 text-zinc-600 opacity-100 transition-all hover:bg-zinc-800 hover:text-amber-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <ListFilter className="size-3.5" aria-hidden />
              </button>
            )}
            {onDrill && (
              <button
                type="button"
                onClick={onDrill}
                title={drillHint ?? "Drill down"}
                aria-label={`${drillHint ?? `Open ${label} details`}`}
                className="rounded p-0.5 text-zinc-600 opacity-100 transition-all hover:bg-zinc-800 hover:text-emerald-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <ArrowUpRight className="size-3.5" aria-hidden />
              </button>
            )}
            {tipWithPrev ? (
              <UiTooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="size-3 cursor-help text-zinc-600 hover:text-zinc-400" aria-label={tipWithPrev} />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-52 text-xs">
                  {tipWithPrev}
                </TooltipContent>
              </UiTooltip>
            ) : null}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
              {value}
            </p>
            {delta && days ? <DeltaChip delta={delta} days={days} /> : null}
          </div>
          {sparkline && sparkline.length > 1 ? (
            <Sparkline values={sparkline} className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── chart tooltip ───────────────────────── */

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  items,
  fmt,
}: {
  active?: boolean;
  items: TooltipPayloadItem[] | undefined;
  fmt: (item: TooltipPayloadItem) => { label: string; value: string } | null;
}) {
  if (!active || !items?.length) return null;
  const rows = items.map(fmt).filter((x): x is { label: string; value: string } => x !== null);
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2 shadow-xl">
      {rows.map((r, i) => (
        <p key={`${r.label}-${i}`} className="text-xs text-zinc-300">
          <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: items[i]?.color ?? "#a1a1aa" }} aria-hidden />
          <span className="text-zinc-400">{r.label}</span>{" "}
          <span className="font-mono tabular-nums text-zinc-100">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ───────────────────────────── view ───────────────────────────── */

/** Smooth-scroll to an in-page KPI drill target section. */
function scrollToSection(id: string): () => void {
  return () => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

export function AnalyticsView() {
  const [days, setDays] = useState<RangeDays>(7);
  /** fairness drill-down (BR-17): topic opened from the chart */
  const [drillTopic, setDrillTopic] = useState<string | null>(null);
  const setView = useAppStore((s) => s.setView);
  const setReviewPreset = useAppStore((s) => s.setReviewPreset);
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics", days],
    queryFn: () => fetchAnalytics(days),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-300" aria-hidden />
            <p className="text-sm text-zinc-300">Analytics are unavailable right now.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="mr-2 size-3.5" aria-hidden />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalVerdicts = ALL_LABELS.reduce((s, l) => s + (data.verdictMix[l] ?? 0), 0);
  const donutData = ALL_LABELS.filter((l) => (data.verdictMix[l] ?? 0) > 0).map((l) => ({
    label: l,
    name: LABEL_META[l].short,
    value: data.verdictMix[l] ?? 0,
  }));

  // 7d stays daily; wider windows aggregate to weekly buckets so labels stay readable
  const isWeekly = days > 7;
  const volumeRows = isWeekly ? bucketWeekly(data.dailyVolume) : data.dailyVolume;
  const dailyData = volumeRows.map((d) => ({
    ...d,
    day: isWeekly
      ? format(new Date(`${d.date}T00:00:00`), "MMM d")
      : format(new Date(`${d.date}T00:00:00`), "EEE"),
  }));
  const rangeAnalyses = data.rangeTotals?.analyses;
  const rangeReviews = data.rangeTotals?.reviews;

  const reviewData = (["accept", "edit", "reject"] as const)
    .map((k) => ({ action: k, count: data.reviewActions[k] ?? 0 }))
    .filter((r) => r.count > 0);

  const fairnessData = data.fairnessByTopic.slice(0, 6).map((t) => ({
    ...t,
    shareLabel: `${Math.round(t.contradictedShare * 100)}% · ${t.total}`,
  }));

  const totalReviews = reviewData.reduce((s, r) => s + r.count, 0);

  // period-over-period KPI trends (backend-computed, same window as the selector)
  const trends = data.trends;
  const sparkline = data.sparkline ?? [];

  /** Long-format CSV export of the current window's metrics (BR-16/17 ops data). */
  function exportCsv(snapshot: AnalyticsDTO): void {
    try {
      const rows: Array<Array<string | number>> = [["section", "metric", "value", "detail"]];
      const push = (section: string, metric: string, value: string | number, detail = "") =>
        rows.push([section, metric, value, detail]);
      push("overview", "generated_at", new Date().toISOString());
      push("overview", "window_days", days);
      push("overview", "analyses_total", snapshot.totals.analyses);
      push("overview", "reviews_total", snapshot.totals.reviews);
      push("overview", "appeals_total", snapshot.totals.appeals);
      push("overview", "reviewers_total", snapshot.totals.reviewers);
      push("overview", "abstention_rate", snapshot.abstentionRate.toFixed(4));
      push("overview", "override_rate", snapshot.overrideRate.toFixed(4));
      push("overview", "latency_p50_ms", snapshot.latency.p50);
      push("overview", "latency_p95_ms", snapshot.latency.p95);
      push("overview", "latency_samples", snapshot.latency.samples);
      push(
        "overview",
        "appeal_median_resolution_hours",
        snapshot.appealMedianResolutionHours ?? "n/a"
      );
      for (const [label, count] of Object.entries(snapshot.verdictMix)) {
        push("verdict_mix", label, count);
      }
      for (const [status, count] of Object.entries(snapshot.statusMix)) {
        push("status_mix", status, count);
      }
      for (const [action, count] of Object.entries(snapshot.reviewActions)) {
        push("review_actions", action, count);
      }
      for (const [state, count] of Object.entries(snapshot.appealMix)) {
        push("appeal_mix", state, count);
      }
      for (const d of snapshot.dailyVolume) {
        push("daily_volume", d.date, d.total, `contradicted=${d.contradicted}`);
      }
      for (const t of snapshot.fairnessByTopic) {
        push(
          "fairness_by_topic",
          t.topic,
          t.contradictedShare.toFixed(4),
          `total=${t.total}`
        );
      }
      const stamp = format(new Date(), "yyyyMMdd-HHmm");
      downloadCsv(`veritas-analytics-${days}d-${stamp}.csv`, rows);
      toast({
        title: "Analytics exported",
        description: `${rows.length - 1} metrics as CSV (last ${days} days).`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "The analytics snapshot could not be exported right now.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* header + range selector */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Operations analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Volume, verdict mix, abstention, overrides, latency and fairness (BR-16/17).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(data)}
            title="Download the current window's metrics as CSV"
            className="h-8 gap-1.5 border-zinc-800 bg-zinc-900/70 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          >
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </Button>
          <div
            role="group"
            aria-label="Date range"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1"
          >
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={days === option}
              onClick={() => setDays(option)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                days === option
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  days === option ? "bg-emerald-400" : "bg-zinc-700"
                )}
              />
              {option}d
            </button>
          ))}
          </div>
        </div>
      </header>

      {/* KPI tiles */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          icon={FileSearch}
          value={data.totals.analyses.toLocaleString()}
          label="Analyses"
          accent="text-emerald-400/80"
          days={days}
          sparkline={sparkline}
          delta={trends?.analyses ? { ...trends.analyses, kind: "count", good: "up" } : undefined}
          tip={
            typeof rangeAnalyses === "number"
              ? `${rangeAnalyses.toLocaleString()} in the last ${days} days`
              : undefined
          }
          onDrill={() => {
            setReviewPreset({ status: "pending_review" });
            setView("review");
          }}
          drillHint="Open the review queue pre-filtered to items awaiting review"
        />
        <KpiTile
          icon={BookOpenCheck}
          value={data.totals.reviews.toLocaleString()}
          label="Reviews"
          accent="text-teal-400/80"
          days={days}
          delta={trends?.reviews ? { ...trends.reviews, kind: "count", good: "up" } : undefined}
          tip={
            typeof rangeReviews === "number"
              ? `${rangeReviews.toLocaleString()} in the last ${days} days`
              : undefined
          }
          onDrill={scrollToSection("kpi-drill-review-actions")}
          drillHint="Show the review-actions breakdown"
        />
        <KpiTile
          icon={ScrollText}
          value={data.totals.appeals.toLocaleString()}
          label="Appeals"
          accent="text-amber-400/80"
          onDrill={() => setView("appeals")}
          drillHint="Open the appeals workflow"
        />
        <KpiTile
          icon={HelpCircle}
          value={fmtPercent(data.abstentionRate)}
          label="Abstention"
          accent="text-zinc-400"
          days={days}
          delta={trends?.abstention ? { ...trends.abstention, kind: "rate", good: "none" } : undefined}
          tip="Share of analyses the system responsibly abstained on"
          onDrill={scrollToSection("kpi-drill-verdict-mix")}
          drillHint="Show the verdict mix — abstained items are Unverified"
          onDrillSecondary={() => {
            setReviewPreset({ label: "Unverified" });
            setView("review");
          }}
          drillHintSecondary="Open the review queue pre-filtered to abstained (Unverified) items"
        />
        <KpiTile
          icon={Gauge}
          value={fmtPercent(data.overrideRate)}
          label="Override rate"
          accent="text-rose-400/80"
          days={days}
          delta={trends?.override ? { ...trends.override, kind: "rate", good: "down" } : undefined}
          tip="Reviews where the human changed the model's recommendation"
          onDrill={scrollToSection("kpi-drill-review-actions")}
          drillHint="Show accept / edit / reject review actions"
        />
        <KpiTile
          icon={Gauge}
          value={`${data.latency.p95.toLocaleString()} ms`}
          label="Latency p95"
          accent="text-emerald-400/80"
          days={days}
          delta={trends?.latencyP95 ? { ...trends.latencyP95, kind: "ms", good: "down" } : undefined}
          onDrill={() => setView("model-card")}
          drillHint="Open the model card — engine performance metrics"
        />
      </section>

      {/* charts row 1 */}
      <section
        id="kpi-drill-verdict-mix"
        aria-label="Verdict mix and daily volume"
        className="mt-6 scroll-mt-20 grid gap-4 lg:grid-cols-2"
      >
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-zinc-200">Verdict mix</CardTitle>
            <CardDescription className="text-xs">
              Overall label distribution across all analyses.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="relative h-64" role="img" aria-label={`Donut chart of verdict mix: ${donutData.map((d) => `${d.name} ${d.value}`).join(", ")}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="85%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {donutData.map((d) => (
                      <Cell key={d.label} fill={LABEL_HEX[d.label] ?? "#a1a1aa"} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        items={payload as TooltipPayloadItem[] | undefined}
                        fmt={(item) => {
                          if (item.name === undefined || item.value === undefined) return null;
                          const pct = totalVerdicts ? (Number(item.value) / totalVerdicts) * 100 : 0;
                          return { label: String(item.name), value: `${item.value} (${pct.toFixed(1)}%)` };
                        }}
                      />
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                  {totalVerdicts.toLocaleString()}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">analyses</span>
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {donutData.map((d) => (
                <li key={d.label} className="flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-300" title={LABEL_META[d.label].description}>
                  <span className="size-2 rounded-full" style={{ background: LABEL_HEX[d.label] }} aria-hidden />
                  {LABEL_META[d.label].short}
                  <span className="font-mono tabular-nums text-zinc-400">{d.value}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-zinc-200">
              {isWeekly ? "Weekly volume" : "Daily volume"} ({days} days)
            </CardTitle>
            <CardDescription className="text-xs">
              Analyses per {isWeekly ? "week" : "day"} with Contradicted overlaid
              {typeof rangeAnalyses === "number" && (
                <> · <span className="font-mono tabular-nums text-zinc-400">{rangeAnalyses.toLocaleString()}</span> in range</>
              )}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div
              className="h-64"
              role="img"
              aria-label={`Bar chart of analyses per ${isWeekly ? "week" : "day"} for the last ${days} days, with contradicted subset highlighted`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} barGap={2} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="day"
                    // thin out tick labels when there are many weekly buckets
                    interval={dailyData.length > 10 ? Math.ceil(dailyData.length / 8) : 0}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(63,63,70,0.25)" }}
                    content={({ active, payload, label }) => (
                      <ChartTooltip
                        active={active}
                        items={payload as TooltipPayloadItem[] | undefined}
                        fmt={(item) =>
                          item.name !== undefined
                            ? {
                                label: `${label ?? ""} ${String(item.name)}`,
                                value: String(item.value ?? 0),
                              }
                            : null
                        }
                      />
                    )}
                  />
                  <Bar dataKey="total" name="Analyses" fill="#52525b" fillOpacity={0.45} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="contradicted" name="Contradicted" fill={LABEL_HEX[TAXONOMY.CONTRADICTED]} radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* charts row 2 */}
      <section
        id="kpi-drill-review-actions"
        aria-label="Review actions and fairness by topic"
        className="mt-6 scroll-mt-20 grid gap-4 lg:grid-cols-2"
      >
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-zinc-200">Review actions</CardTitle>
            <CardDescription className="text-xs">
              Human decisions on model recommendations ({totalReviews.toLocaleString()} reviews).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-56" role="img" aria-label="Horizontal bar chart of review actions: accept, edit, reject">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reviewData} layout="vertical" margin={{ top: 4, right: 36, left: 6, bottom: 4 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="action"
                    width={62}
                    tick={{ fontSize: 11, fill: "#d4d4d8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(63,63,70,0.25)" }}
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        items={payload as TooltipPayloadItem[] | undefined}
                        fmt={(item) => {
                          const action = item.payload?.action;
                          return action
                            ? {
                                label: `${String(action).charAt(0).toUpperCase() + String(action).slice(1)} reviews`,
                                value: String(item.value ?? 0),
                              }
                            : null;
                        }}
                      />
                    )}
                  />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={22}>
                    {reviewData.map((r) => (
                      <Cell key={r.action} fill={REVIEW_ACTION_HEX[r.action] ?? "#a1a1aa"} />
                    ))}
                    <LabelList
                      dataKey="count"
                      position="right"
                      style={{ fill: "#a1a1aa", fontSize: 11, fontFamily: "var(--font-mono)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" aria-hidden />Accepted</li>
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" aria-hidden />Edited (override)</li>
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-400" aria-hidden />Rejected (override)</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-zinc-200">Fairness by topic (BR-17)</CardTitle>
            <CardDescription className="text-xs">
              Contradicted share per topic — subgroup gaps are surfaced for oversight.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-56 cursor-pointer" role="button" tabIndex={0} aria-label="Horizontal bar chart of contradicted share by topic for the top 6 topics. Activate a row to drill into that topic's analyses." onKeyDown={(e) => { if (e.key === "Enter" && fairnessData[0]) setDrillTopic(fairnessData[0].topic); }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fairnessData} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
                  <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="topic"
                    width={96}
                    tick={{ fontSize: 11, fill: "#d4d4d8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(63,63,70,0.25)" }}
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        items={payload as TooltipPayloadItem[] | undefined}
                        fmt={(item) => {
                          const p = item.payload;
                          return p
                            ? {
                                label: `${String(p.topic)} — contradicted share of ${String(p.total)} analyses`,
                                value: fmtPercent(Number(p.contradictedShare ?? 0), 0),
                              }
                            : null;
                        }}
                      />
                    )}
                  />
                  <Bar
                    dataKey="contradictedShare"
                    fill={LABEL_HEX[TAXONOMY.CONTRADICTED]}
                    radius={[0, 3, 3, 0]}
                    maxBarSize={18}
                    onClick={(entry: unknown) => {
                      // recharts hands over the bar's row payload defensively typed
                      const topic = (entry as { payload?: { topic?: string } } | null)?.payload?.topic;
                      if (typeof topic === "string" && topic) setDrillTopic(topic);
                    }}
                  >
                    <LabelList
                      dataKey="shareLabel"
                      position="right"
                      style={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Subgroup gaps are surfaced, not hidden — see known limitations in the model card.
            </p>
            {/* topic chips — drill-down always reachable, even for zero-share bars */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {fairnessData.map((topic) => (
                <button
                  key={topic.topic}
                  type="button"
                  onClick={() => setDrillTopic(topic.topic)}
                  title={`Drill into ${topic.topic}: ${topic.total} analyses, ${Math.round(topic.contradictedShare * 100)}% contradicted`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 active:scale-[0.97]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      topic.contradictedShare > 0 ? "bg-rose-400" : "bg-zinc-600"
                    )}
                  />
                  <span className="max-w-32 truncate">{topic.topic}</span>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                    {topic.total}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* latency + SLA strip */}
      <Card className="mt-4 border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                <Gauge className="size-3.5" aria-hidden /> Latency p50
              </dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100">
                {data.latency.p50.toLocaleString()} <span className="text-xs font-normal text-zinc-500">ms</span>
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                <Gauge className="size-3.5" aria-hidden /> Latency p95
              </dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100">
                {data.latency.p95.toLocaleString()} <span className="text-xs font-normal text-zinc-500">ms</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Samples</dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100">
                {data.latency.samples.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                <Clock className="size-3.5" aria-hidden /> Appeal median
              </dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100">
                {data.appealMedianResolutionHours === null ? (
                  <span className="text-sm font-normal text-zinc-500">No resolutions yet</span>
                ) : (
                  <>
                    {data.appealMedianResolutionHours.toFixed(1)}
                    <span className="text-xs font-normal text-zinc-500"> h to resolve</span>
                  </>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
            Target: triage &lt; 10s p95 (BRD NFR). Latency measured end-to-end per analysis request.
          </p>
        </CardContent>
      </Card>

      {/* fairness drill-down (BR-17) */}
      <FairnessDrillDialog topic={drillTopic} onClose={() => setDrillTopic(null)} />
    </div>
  );
}

/* ─────────────── Fairness drill-down dialog (BR-17) ─────────────── */

/**
 * Topic drill-down from the fairness chart — lists every analysis carrying
 * the selected topic, so reviewers can inspect the subgroup the chart is
 * surfacing. Opening a row jumps straight to its evidence-first dossier.
 */
function FairnessDrillDialog({ topic, onClose }: { topic: string | null; onClose: () => void }) {
  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const setView = useAppStore((s) => s.setView);
  const setReviewPreset = useAppStore((s) => s.setReviewPreset);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["analyses", "fairness-drill", topic],
    queryFn: () => fetchAnalyses({ topic: topic ?? "", pageSize: 50 }),
    enabled: topic !== null,
  });

  const analyses: AnalysisDTO[] = data?.analyses ?? [];
  const contradicted = analyses.filter((a) => a.overallLabel === TAXONOMY.CONTRADICTED).length;

  return (
    <Dialog open={topic !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-zinc-800 bg-zinc-900/95 p-0 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <DialogHeader className="border-b border-zinc-800 px-4 py-3">
          <DialogTitle className="text-sm font-medium text-zinc-100">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Fairness drill-down · topic</span>
            <span className="mt-1 flex items-center gap-2 text-base font-semibold uppercase tracking-wide text-zinc-100">
              <ScrollText className="size-4 text-rose-400/80" aria-hidden />
              {topic ?? ""}
            </span>
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-zinc-500">
            The analyses behind this subgroup&apos;s bar (BR-17) — Contradicted {contradicted} of{" "}
            {analyses.length}.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : isError ? (
            <p className="p-6 text-center text-sm text-zinc-400">
              Couldn&apos;t load this topic&apos;s analyses.
            </p>
          ) : analyses.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-400">
              No analyses carry this topic in the current data.
            </p>
          ) : (
            analyses.map((analysis) => (
              <button
                key={analysis.id}
                type="button"
                onClick={() => {
                  onClose();
                  openAnalysis(analysis.id);
                }}
                className="group mb-2 block w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 text-left transition-all hover:border-zinc-600 hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60 active:scale-[0.995]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={analysis.status} />
                  <VerdictBadge label={analysis.overallLabel} size="sm" />
                  {analysis.highImpact && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      High-impact
                    </span>
                  )}
                  <time
                    dateTime={analysis.createdAt}
                    className="ml-auto whitespace-nowrap font-mono text-[11px] text-zinc-500"
                  >
                    {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                  </time>
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-zinc-300">
                  {analysis.inputText}
                </p>
              </button>
            ))
          )}
        </div>

        <p className="border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[10px] text-zinc-600">
          Verdicts are never automated — every row opens the evidence-first dossier for human
          review (BR-11).
        </p>
        {analyses.length > 0 && (
          <div className="border-t border-zinc-800/70 bg-zinc-950/60 px-4 py-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!topic) return;
                onClose();
                setReviewPreset({ topic });
                setView("review");
              }}
              className="h-7 gap-1.5 border-zinc-700 bg-zinc-900/60 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            >
              Continue in the review queue
              <ArrowRight className="size-3" aria-hidden />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
