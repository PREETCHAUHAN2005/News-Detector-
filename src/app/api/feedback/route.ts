/**
 * POST /api/feedback — reviewer feedback as labelled data (BR-15).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ALL_LABELS, REVIEWER_ROLES } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  verdictId: z.string().min(1),
  agree: z.boolean(),
  correctedLabel: z.enum(ALL_LABELS as [string, ...string[]]).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    // feedback feeds retraining — keep it abuse-resistant without login (BRD §8)
    const rl = rateLimit(`feedback:${clientIp(req)}`, 30, 30);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many feedback submissions — please retry shortly" }, { status: 429 });
    }

    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!REVIEWER_ROLES.includes(user.role ?? "viewer")) {
      return NextResponse.json({ error: "Reviewer role required" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { verdictId, agree, correctedLabel, notes } = parsed.data;

    const verdict = await db.verdict.findUnique({ where: { id: verdictId } });
    if (!verdict) {
      return NextResponse.json({ error: "Verdict not found" }, { status: 404 });
    }

    const feedback = await db.feedback.create({
      data: { verdictId, reviewerId: user.id, agree, correctedLabel, notes },
    });
    await audit(
      "feedback_recorded",
      "verdict",
      verdictId,
      { agree, correctedLabel, queuedForRetraining: true },
      user.id
    );
    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("feedback-error", error);
    return NextResponse.json({ error: "Failed to record feedback" }, { status: 500 });
  }
}
