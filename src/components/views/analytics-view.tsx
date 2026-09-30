"use client";
/**
 * Operations analytics (BR-16/17) — volume, verdict mix, abstention,
 * overrides, latency percentiles and fairness-by-topic surfacing.
 */
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
import { format } from "date-fns";
import {
  AlertTriangle,
  BookOpenCheck,
  Clock,
  FileSearch,
  Gauge,
  HelpCircle,
  RotateCcw,
  ScrollText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchAnalytics } from "@/lib/api";
import { ALL_LABELS, LABEL_META, TAXONOMY } from "@/lib/taxonomy";

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

/* ───────────────────────────── KPI tile ───────────────────────────── */

function KpiTile({
  icon: Icon,
  value,
  label,
  tip,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  tip?: string;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          {tip ? (
            <UiTooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="ml-auto size-3 shrink-0 cursor-help text-zinc-600 hover:text-zinc-400" aria-label={tip} />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-52 text-xs">
                {tip}
              </TooltipContent>
            </UiTooltip>
          ) : null}
        </div>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-100">
          {value}
        </p>
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

export function AnalyticsView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics"],
    queryFn: fetchAnalytics,
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

  const dailyData = data.dailyVolume.map((d) => ({
    ...d,
    day: format(new Date(`${d.date}T00:00:00`), "EEE"),
  }));

  const reviewData = (["accept", "edit", "reject"] as const)
    .map((k) => ({ action: k, count: data.reviewActions[k] ?? 0 }))
    .filter((r) => r.count > 0);

  const fairnessData = data.fairnessByTopic.slice(0, 6).map((t) => ({
    ...t,
    shareLabel: `${Math.round(t.contradictedShare * 100)}% · ${t.total}`,
  }));

  const totalReviews = reviewData.reduce((s, r) => s + r.count, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* header */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">Operations analytics</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Volume, verdict mix, abstention, overrides, latency and fairness (BR-16/17).
        </p>
      </header>

      {/* KPI tiles */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          icon={FileSearch}
          value={data.totals.analyses.toLocaleString()}
          label="Analyses"
        />
        <KpiTile
          icon={BookOpenCheck}
          value={data.totals.reviews.toLocaleString()}
          label="Reviews"
        />
        <KpiTile
          icon={ScrollText}
          value={data.totals.appeals.toLocaleString()}
          label="Appeals"
        />
        <KpiTile
          icon={HelpCircle}
          value={fmtPercent(data.abstentionRate)}
          label="Abstention"
          tip="Share of analyses the system responsibly abstained on"
        />
        <KpiTile
          icon={Gauge}
          value={fmtPercent(data.overrideRate)}
          label="Override rate"
          tip="Reviews where the human changed the model's recommendation"
        />
        <KpiTile
          icon={Gauge}
          value={`${data.latency.p95.toLocaleString()} ms`}
          label="Latency p95"
        />
      </section>

      {/* charts row 1 */}
      <section aria-label="Verdict mix and daily volume" className="mt-4 grid gap-4 lg:grid-cols-2">
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
                <li key={d.label} className="flex items-center gap-1.5 text-[11px] text-zinc-400" title={LABEL_META[d.label].description}>
                  <span className="size-2 rounded-full" style={{ background: LABEL_HEX[d.label] }} aria-hidden />
                  {LABEL_META[d.label].short}
                  <span className="font-mono tabular-nums text-zinc-500">{d.value}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="text-sm font-medium text-zinc-200">Daily volume (7 days)</CardTitle>
            <CardDescription className="text-xs">
              Analyses per day with Contradicted overlaid.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-64" role="img" aria-label="Bar chart of analyses per day for the last 7 days, with contradicted subset highlighted">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} barGap={2} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="day"
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
                  <Bar dataKey="total" name="Analyses" fill="#3f3f46" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="contradicted" name="Contradicted" fill={LABEL_HEX[TAXONOMY.CONTRADICTED]} radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* charts row 2 */}
      <section aria-label="Review actions and fairness by topic" className="mt-4 grid gap-4 lg:grid-cols-2">
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
            <div className="h-56" role="img" aria-label="Horizontal bar chart of contradicted share by topic for the top 6 topics">
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
                  <Bar dataKey="contradictedShare" fill={LABEL_HEX[TAXONOMY.CONTRADICTED]} radius={[0, 3, 3, 0]} maxBarSize={18}>
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
    </div>
  );
}
