/**
 * GET /api/analyses/[id] — full dossier for one analysis (BR-10).
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const analysis = await db.analysis.findUnique({
      where: { id },
      include: {
        submittedBy: { select: { id: true, name: true, role: true } },
        claims: {
          orderBy: { position: "asc" },
          include: {
            verdict: {
              include: {
                evidence: { orderBy: { rank: "asc" }, include: { source: true } },
                reviews: {
                  orderBy: { createdAt: "asc" },
                  include: { reviewer: { select: { id: true, name: true, role: true } } },
                },
                appeals: true,
                feedback: { include: { reviewer: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("analysis-detail-error", error);
    return NextResponse.json({ error: "Failed to fetch analysis" }, { status: 500 });
  }
}
