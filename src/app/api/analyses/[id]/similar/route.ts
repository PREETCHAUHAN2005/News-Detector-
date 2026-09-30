/**
 * GET /api/analyses/[id]/similar — precedent lookup for the dossier.
 *
 * Surfaces the most similar previously human-reviewed claims (char-channel
 * cosine, same channel as the BR-08 reuse gate but with a lower advisory
 * threshold). Reviewers see how near-identical claims were ruled before —
 * consistency support only; nothing is auto-applied to the current verdict.
 *
 * Fail-safe: engine unreachable → empty list (the panel degrades quietly).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { engineSimilarList } from "@/lib/nlp-client";

export const dynamic = "force-dynamic";

const MAX_CANDIDATES = 400;
const TOP_N = 3;
const MIN_SIM = 0.3;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const analysis = await db.analysis.findUnique({
      where: { id },
      select: { id: true, inputText: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    // Previously human-reviewed claims only — precedents must cite a human decision.
    const priorClaims = await db.claim.findMany({
      where: {
        verdict: { reviews: { some: {} } },
        analysisId: { not: id }, // never surface the dossier itself
      },
      select: {
        id: true,
        analysisId: true,
        text: true,
        verdict: {
          select: {
            reviews: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                finalLabel: true,
                createdAt: true,
                action: true,
                reviewer: { select: { name: true } },
              },
            },
          },
        },
      },
      take: MAX_CANDIDATES,
    });

    const candidates = priorClaims
      .filter((c) => c.verdict?.reviews?.[0]?.finalLabel)
      .map((c) => ({
        claimId: c.id,
        analysisId: c.analysisId,
        text: c.text,
        finalLabel: c.verdict!.reviews![0].finalLabel!,
        reviewedAt: c.verdict!.reviews![0].createdAt,
        reviewerName: c.verdict!.reviews![0].reviewer?.name ?? null,
      }));

    if (candidates.length === 0) {
      return NextResponse.json({ matches: [], checkedCount: 0 });
    }

    const matches = await engineSimilarList(analysis.inputText, candidates, TOP_N, MIN_SIM);

    // enrich with the candidate metadata (similarity comes from the engine)
    const byId = new Map(candidates.map((c) => [c.claimId, c]));
    const enriched = matches
      .map((m) => {
        const meta = m.claimId ? byId.get(m.claimId) : undefined;
        if (!meta) return null;
        return {
          claimId: meta.claimId,
          analysisId: meta.analysisId,
          text: meta.text,
          finalLabel: meta.finalLabel,
          similarity: typeof m.similarity === "number" ? m.similarity : 0,
          reviewedAt: meta.reviewedAt,
          reviewerName: meta.reviewerName,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({ matches: enriched, checkedCount: candidates.length });
  } catch (error) {
    console.error("similar-analyses-error", error);
    return NextResponse.json({ error: "Failed to fetch similar analyses" }, { status: 500 });
  }
}
