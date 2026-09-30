/**
 * GET /api/audit — filterable audit trail (BR-13).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") ?? undefined;
    const entityType = searchParams.get("entityType") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50);

    const where: Record<string, unknown> = {};
    if (action && action !== "all") where.action = action;
    if (entityType && entityType !== "all") where.entityType = entityType;

    const [logs, total, actions] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { name: true, role: true } } },
      }),
      db.auditLog.count({ where }),
      db.auditLog.groupBy({ by: ["action"], _count: { _all: true } }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      pageSize,
      availableActions: actions.map((a) => a.action),
    });
  } catch (error) {
    console.error("audit-error", error);
    return NextResponse.json({ error: "Failed to list audit log" }, { status: 500 });
  }
}
