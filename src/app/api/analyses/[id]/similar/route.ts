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
const MAX_CLAIM_PRECEDENTS = 8;
const CLAIM_TOP_N = 2;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const analysis = await db.analysis.findUnique({
      where: { id },
      select: {
        id: true,
        inputText: true,
        claims: {
          orderBy: { position: "asc" },
          select: { id: true, position: true, text: true, assessable: true },
        },
      },
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
    const enrich = (list: Awaited<ReturnType<typeof engineSimilarList>>) =>
      list
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

    const enriched = enrich(matches);

    // Per-claim precedent sweep (multi-claim inputs): each assessable claim is
    // compared against the same human-ruled corpus so reviewers see which
    // specific claim the precedent supports. Advisory only, same as above.
    const assessableClaims = analysis.claims
      .filter((c) => c.assessable)
      .slice(0, MAX_CLAIM_PRECEDENTS);
    const claimMatches: {
      claimId: string;
      position: number;
      text: string;
      matches: NonNullable<(typeof enriched)[number]>[];
    }[] = [];
    if (assessableClaims.length > 1) {
      for (const claim of assessableClaims) {
        const claimMatchList = await engineSimilarList(
          claim.text,
          candidates,
          CLAIM_TOP_N,
          MIN_SIM
        );
        const enrichedClaimMatches = enrich(claimMatchList);
        if (enrichedClaimMatches.length > 0) {
          claimMatches.push({
            claimId: claim.id,
            position: claim.position,
            text: claim.text,
            matches: enrichedClaimMatches,
          });
        }
      }
    }

    return NextResponse.json({
      matches: enriched,
      checkedCount: candidates.length,
      claimMatches,
    });
  } catch (error) {
    console.error("similar-analyses-error", error);
    return NextResponse.json({ error: "Failed to fetch similar analyses" }, { status: 500 });
  }
}
