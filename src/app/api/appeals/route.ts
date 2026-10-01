/**
 * /api/appeals — GET list, POST file (public, rate-limited) (BR-14).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const fileSchema = z.object({
  verdictId: z.string().min(1),
  appellantName: z.string().min(2).max(120),
  appellantEmail: z.string().email().max(200).optional().or(z.literal("")),
  reason: z.string().min(10, "Please describe the reason (min 10 characters)").max(4000),
});

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;

    const appeals = await db.appeal.findMany({
      where: status && status !== "all" ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        verdict: {
          include: {
            claim: { include: { analysis: { select: { id: true, inputText: true, overallLabel: true } } } },
            reviews: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
        resolver: { select: { id: true, name: true, role: true } },
      },
    });
    return NextResponse.json({ appeals });
  } catch (error) {
    console.error("appeals-error", error);
    return NextResponse.json({ error: "Failed to list appeals" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const rl = rateLimit(`appeal:${clientIp(req)}`, 3, 3);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many appeals — please retry later" }, { status: 429 });
    }

    const parsed = fileSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { verdictId, appellantName, appellantEmail, reason } = parsed.data;

    const verdict = await db.verdict.findUnique({
      where: { id: verdictId },
      include: { claim: { include: { analysis: true } } },
    });
    if (!verdict?.claim?.analysis) {
      return NextResponse.json({ error: "Verdict not found" }, { status: 404 });
    }

    const appeal = await db.appeal.create({
      data: {
        verdictId,
        appellantName,
        appellantEmail: appellantEmail || null,
        reason,
        status: "open",
      },
    });
    await db.analysis.update({
      where: { id: verdict.claim.analysis.id },
      data: { status: "appealed" },
    });

    const actor = await getSessionUser();
    await audit(
      "appeal_filed",
      "appeal",
      appeal.id,
      { verdictId, analysisId: verdict.claim.analysis.id, appellantName },
      actor?.id ?? null
    );

    return NextResponse.json({ appeal });
  } catch (error) {
    console.error("appeal-file-error", error);
    return NextResponse.json({ error: "Failed to file appeal" }, { status: 500 });
  }
}
