/**
 * GET /api/analyses — review queue / history with filters (BR-10).
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Queue sort modes — newest is the default triage order; the alternatives
 *  serve reviewer workflows (oldest-first backlog burn-down, high-impact
 *  risk-first per BR-12). Arrays keep Prisma's multi-field orderBy valid. */
const SORT_MODES: Record<
  string,
  { createdAt?: "asc" | "desc"; highImpact?: "desc" }[]
> = {
  newest: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  high_impact: [{ highImpact: "desc" }, { createdAt: "desc" }],
};

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;
    const label = searchParams.get("label") ?? undefined;
    const search = searchParams.get("q") ?? undefined;
    const highImpact = searchParams.get("highImpact");
    const topic = searchParams.get("topic") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20);
    const sortParam = searchParams.get("sort") ?? "newest";
    const orderBy = SORT_MODES[sortParam] ?? SORT_MODES.newest;

    const where: Record<string, unknown> = {};
    if (status && status !== "all") where.status = status;
    if (label && label !== "all") where.overallLabel = label;
    if (highImpact === "true") where.highImpact = true;
    if (topic && topic !== "all") {
      // fairness drill-down (BR-17): exact topic match, sanitized length
      where.topic = topic.slice(0, 60);
    }
    if (search) {
      where.inputText = { contains: search };
    }

    const [analyses, total] = await Promise.all([
      db.analysis.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          submittedBy: { select: { id: true, name: true, role: true } },
          claims: {
            include: {
              verdict: {
                include: {
                  evidence: { orderBy: { rank: "asc" } },
                  reviews: { include: { reviewer: { select: { name: true, role: true } } } },
                },
              },
            },
          },
        },
      }),
      db.analysis.count({ where }),
    ]);

    return NextResponse.json({ analyses, total, page, pageSize });
  } catch (error) {
    console.error("analyses-error", error);
    return NextResponse.json({ error: "Failed to list analyses" }, { status: 500 });
  }
}
