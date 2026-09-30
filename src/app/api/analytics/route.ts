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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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

    // volume by day (last 7 days)
    const dayMap = new Map<string, { total: number; contradicted: number }>();
    for (let i = 6; i >= 0; i--) {
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
