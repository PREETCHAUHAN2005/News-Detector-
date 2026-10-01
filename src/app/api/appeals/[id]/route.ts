/**
 * PATCH /api/appeals/[id] — resolve an appeal (senior reviewer / admin) (BR-14).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { SENIOR_ROLES } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  status: z.enum(["in_review", "resolved_upheld", "resolved_overturned"]),
  resolutionNotes: z.string().max(4000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // appeal resolution is a governance action — abuse-resistant without login (BRD §8)
    const rl = rateLimit(`appeal-resolve:${clientIp(req)}`, 20, 20);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many resolution attempts — please retry shortly" }, { status: 429 });
    }

    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!SENIOR_ROLES.includes(user.role ?? "viewer")) {
      return NextResponse.json({ error: "Senior reviewer or admin role required" }, { status: 403 });
    }

    const parsed = resolveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { id } = await params;

    const appeal = await db.appeal.findUnique({
      where: { id },
      include: { verdict: { include: { claim: { include: { analysis: true } } } } },
    });
    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 });
    }
    if (appeal.status.startsWith("resolved")) {
      return NextResponse.json({ error: "Appeal already resolved" }, { status: 409 });
    }

    const isFinal = parsed.data.status.startsWith("resolved");
    const updated = await db.appeal.update({
      where: { id },
      data: {
        status: parsed.data.status,
        resolutionNotes: parsed.data.resolutionNotes ?? appeal.resolutionNotes,
        resolverId: user.id,
        resolvedAt: isFinal ? new Date() : null,
      },
    });

    // an overturned verdict re-opens the analysis for re-review (BR-14)
    if (parsed.data.status === "resolved_overturned" && appeal.verdict?.claim?.analysis) {
      await db.analysis.update({
        where: { id: appeal.verdict.claim.analysis.id },
        data: { status: "pending_review" },
      });
    }

    await audit(
      "appeal_resolved",
      "appeal",
      appeal.id,
      {
        status: parsed.data.status,
        verdictId: appeal.verdictId,
        analysisId: appeal.verdict?.claim?.analysis?.id,
        resolverRole: user.role,
      },
      user.id
    );

    return NextResponse.json({ appeal: updated });
  } catch (error) {
    console.error("appeal-resolve-error", error);
    return NextResponse.json({ error: "Failed to resolve appeal" }, { status: 500 });
  }
}
