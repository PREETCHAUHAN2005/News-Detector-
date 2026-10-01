/**
 * POST /api/reviews — reviewer accept / edit / reject with override and
 * mandatory second review for high-impact cases (BR-11, BR-12).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ALL_LABELS, REVIEWER_ROLES, SENIOR_ROLES, TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  verdictId: z.string().min(1),
  action: z.enum(["accept", "edit", "reject"]),
  finalLabel: z.enum(ALL_LABELS as [string, ...string[]]).optional(),
  notes: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  try {
    // With the login feature disabled the demo reviewer identity is applied,
    // so reviewers' destructive actions stay abuse-resistant (BRD §8).
    const rl = rateLimit(`review:${clientIp(req)}`, 20, 20);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many review actions — please retry shortly" }, { status: 429 });
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
    const { verdictId, action, notes } = parsed.data;
    let { finalLabel } = parsed.data;

    const verdict = await db.verdict.findUnique({
      where: { id: verdictId },
      include: {
        claim: { include: { analysis: true } },
        reviews: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!verdict || !verdict.claim?.analysis) {
      return NextResponse.json({ error: "Verdict not found" }, { status: 404 });
    }
    const analysis = verdict.claim.analysis;
    const existingReviews = verdict.reviews;
    const round = existingReviews.length + 1;

    // ── BR-12: second review must be done by a senior reviewer ──
    if (round === 2 && !SENIOR_ROLES.includes(user.role ?? "viewer")) {
      return NextResponse.json(
        { error: "The second review of a high-impact case requires a senior reviewer" },
        { status: 403 }
      );
    }
    if (round > 2) {
      return NextResponse.json({ error: "This verdict already has the maximum reviews" }, { status: 409 });
    }

    if (action === "edit" && !finalLabel) {
      return NextResponse.json({ error: "finalLabel is required when editing" }, { status: 400 });
    }
    if (action === "accept") finalLabel = verdict.label;
    if (action === "reject" && !finalLabel) finalLabel = TAXONOMY.UNVERIFIED;
    if (action === "reject" && !notes) {
      return NextResponse.json({ error: "Notes are mandatory when rejecting a recommendation" }, { status: 400 });
    }

    const review = await db.review.create({
      data: {
        verdictId,
        reviewerId: user.id,
        round,
        action,
        finalLabel: finalLabel ?? verdict.label,
        notes,
      },
    });

    // ── Workflow state machine ──
    // High-impact: needs TWO reviews (any reviewer → senior) before "reviewed".
    // Normal impact: one review completes it.
    const needsSecond = analysis.highImpact && round === 1;
    await db.analysis.update({
      where: { id: analysis.id },
      data: { status: needsSecond ? "in_review" : "reviewed" },
    });

    await audit(
      "review_submitted",
      "verdict",
      verdictId,
      {
        analysisId: analysis.id,
        action,
        round,
        modelLabel: verdict.label,
        finalLabel: review.finalLabel,
        highImpact: analysis.highImpact,
        overridden: action !== "accept",
        reviewerRole: user.role,
      },
      user.id
    );

    return NextResponse.json({
      review,
      status: needsSecond ? "in_review" : "reviewed",
      needsSecondReview: needsSecond,
    });
  } catch (error) {
    console.error("review-error", error);
    return NextResponse.json({ error: "Failed to record review" }, { status: 500 });
  }
}
