/**
 * GET /api/analytics — operations dashboards (BR-16) + fairness reports (BR-17).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Relative change vs previous period; null when undividable (prev = 0). */
function relDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

interface TrendPoint {
  current: number;
  previous: number;
  /** relative fraction for counts/latency, absolute percentage points for rates */
  delta: number | null;
}

interface Trends {
  analyses: TrendPoint;
  reviews: TrendPoint;
  abstention: TrendPoint;
  override: TrendPoint;
  latencyP95: TrendPoint;
}

function latenciesOf(rows: { latencyMs: number | null }[]): number[] {
  return rows
    .map((a) => a.latencyMs)
    .filter((x): x is number => typeof x === "number" && x > 0)
    .sort((a, b) => a - b);
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Date-range window for volume metrics (BR-16): 7/30/90 days, default 7.
    const { searchParams } = new URL(req.url);
    const daysRaw = parseInt(searchParams.get("days") ?? "7", 10);
    const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [total, byStatus, byLabel, latencyAgg, reviewsAgg, appealsAgg, daily, byTopic] =
      await Promise.all([
        db.analysis.count(),
        db.analysis.groupBy({ by: ["status"], _count: { _all: true } }),
        db.analysis.groupBy({ by: ["overallLabel"], _count: { _all: true } }),
        db.analysis.findMany({
          where: { latencyMs: { gt: 0 } },
          select: { latencyMs: true },
          orderBy: { latencyMs: "asc" },
        }),
        db.review.groupBy({ by: ["action"], _count: { _all: true } }),
        db.appeal.groupBy({ by: ["status"], _count: { _all: true } }),
        db.analysis.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true, overallLabel: true, latencyMs: true },
        }),
        db.analysis.groupBy({
          by: ["topic"],
          _count: { _all: true },
          where: { topic: { not: null } },
          orderBy: { _count: { topic: "desc" } },
          take: 8,
        }),
      ]);

    const latencies = latencyAgg
      .map((a) => a.latencyMs)
      .filter((x): x is number => typeof x === "number" && x > 0)
      .sort((a, b) => a - b);
    const totalReviews = reviewsAgg.reduce((s, r) => s + r._count._all, 0);
    const overrides = reviewsAgg
      .filter((r) => r.action === "edit" || r.action === "reject")
      .reduce((s, r) => s + r._count._all, 0);

    const labelCounts: Record<string, number> = {};
    for (const row of byLabel) {
      labelCounts[row.overallLabel ?? TAXONOMY.UNVERIFIED] = row._count._all;
    }
    const abstained = labelCounts[TAXONOMY.UNVERIFIED] ?? 0;

    // volume by day (last N days)
    const dayMap = new Map<string, { total: number; contradicted: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dayMap.set(d.toISOString().slice(0, 10), { total: 0, contradicted: 0 });
    }
    for (const a of daily) {
      const key = a.createdAt.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) {
        entry.total += 1;
        if (a.overallLabel === TAXONOMY.CONTRADICTED) entry.contradicted += 1;
      }
    }

    // appeal SLA (BR-14): median resolution time
    const resolvedAppeals = await db.appeal.findMany({
      where: { resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    });
    const resolutionHours = resolvedAppeals
      .map((a) => (a.resolvedAt!.getTime() - a.createdAt.getTime()) / 3_600_000)
      .sort((a, b) => a - b);
    const medianResolutionHours = resolutionHours.length
      ? resolutionHours[Math.floor(resolutionHours.length / 2)]
      : null;

    // Previous window for period-over-period KPI trends (BR-16 ops insight).
    const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
    const [prevDaily, reviewsByActionRange, reviewsByActionPrev] = await Promise.all([
      db.analysis.findMany({
        where: { createdAt: { gte: prevSince, lt: since } },
        select: { createdAt: true, overallLabel: true, latencyMs: true },
      }),
      db.review.groupBy({
        by: ["action"],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      db.review.groupBy({
        by: ["action"],
        _count: { _all: true },
        where: { createdAt: { gte: prevSince, lt: since } },
      }),
    ]);

    // Range-scoped totals derived from the window queries above (no extra round-trip).
    const rangeAnalyses = daily.length;
    const rangeReviews = reviewsByActionRange.reduce((s, r) => s + r._count._all, 0);

    // Period-over-period trends.
    const curAbstain = daily.length
      ? daily.filter((a) => a.overallLabel === TAXONOMY.UNVERIFIED).length / daily.length
      : 0;
    const prevAbstain = prevDaily.length
      ? prevDaily.filter((a) => a.overallLabel === TAXONOMY.UNVERIFIED).length / prevDaily.length
      : 0;
    const curLat = percentile(latenciesOf(daily), 95);
    const prevLat = percentile(latenciesOf(prevDaily), 95);
    const sumActions = (rows: { action: string; _count: { _all: number } }[]) =>
      rows.reduce((s, r) => s + r._count._all, 0);
    const sumOverrides = (rows: { action: string; _count: { _all: number } }[]) =>
      rows
        .filter((r) => r.action === "edit" || r.action === "reject")
        .reduce((s, r) => s + r._count._all, 0);
    const prevReviews = sumActions(reviewsByActionPrev);
    const curOverrideRate = rangeReviews ? sumOverrides(reviewsByActionRange) / rangeReviews : 0;
    const prevOverrideRate = prevReviews ? sumOverrides(reviewsByActionPrev) / prevReviews : 0;
    const trends: Trends = {
      analyses: { current: rangeAnalyses, previous: prevDaily.length, delta: relDelta(rangeAnalyses, prevDaily.length) },
      reviews: { current: rangeReviews, previous: prevReviews, delta: relDelta(rangeReviews, prevReviews) },
      abstention: { current: curAbstain, previous: prevAbstain, delta: prevDaily.length ? curAbstain - prevAbstain : null },
      override: { current: curOverrideRate, previous: prevOverrideRate, delta: prevReviews ? curOverrideRate - prevOverrideRate : null },
      latencyP95: { current: curLat, previous: prevLat, delta: relDelta(curLat, prevLat) },
    };

    // fairness (BR-17): verdict mix by topic
    const topicStats = await Promise.all(
      byTopic.map(async (t) => {
        const labels = await db.analysis.groupBy({
          by: ["overallLabel"],
          _count: { _all: true },
          where: { topic: t.topic },
        });
        const mix: Record<string, number> = {};
        for (const l of labels) mix[l.overallLabel ?? "Unknown"] = l._count._all;
        return {
          topic: t.topic ?? "General",
          total: t._count._all,
          mix,
          contradictedShare: (mix[TAXONOMY.CONTRADICTED] ?? 0) / t._count._all,
        };
      })
    );

    return NextResponse.json({
      days,
      rangeTotals: { analyses: rangeAnalyses, reviews: rangeReviews },
      trends,
      sparkline: Array.from(dayMap.values()).map((v) => v.total),
      totals: {
        analyses: total,
        reviews: totalReviews,
        appeals: appealsAgg.reduce((s, a) => s + a._count._all, 0),
        reviewers: await db.user.count({ where: { role: { in: ["reviewer", "senior_reviewer", "admin"] } } }),
      },
      statusMix: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      verdictMix: labelCounts,
      abstentionRate: total ? abstained / total : 0,
      overrideRate: totalReviews ? overrides / totalReviews : 0,
      latency: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        samples: latencies.length,
      },
      reviewActions: Object.fromEntries(reviewsAgg.map((r) => [r.action, r._count._all])),
      appealMix: Object.fromEntries(appealsAgg.map((a) => [a.status, a._count._all])),
      appealMedianResolutionHours: medianResolutionHours,
      dailyVolume: Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v })),
      fairnessByTopic: topicStats,
    });
  } catch (error) {
    console.error("analytics-error", error);
    return NextResponse.json({ error: "Failed to compute analytics" }, { status: 500 });
  }
}
