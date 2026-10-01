/**
 * POST /api/precedents — search previously human-reviewed claims by free text.
 *
 * Lets reviewers check consistency BEFORE running an analysis: paste any
 * statement and see how similar claims were ruled by humans (char-channel
 * cosine, same channel as the BR-08 reuse gate but with a lower advisory
 * threshold). Nothing is auto-applied, nothing is persisted — this is a pure
 * lookup over the human-decision record.
 *
 * Fail-safe: engine unreachable → empty list (the dialog degrades quietly).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { engineSimilarList } from "@/lib/nlp-client";

export const dynamic = "force-dynamic";

const MAX_CANDIDATES = 400;
const TOP_N = 5;
const MIN_SIM = 0.3;
const MAX_TEXT = 2000;

interface PrecedentsBody {
  text?: unknown;
  topN?: unknown;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as PrecedentsBody;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
    if (text.length < 3) {
      return NextResponse.json({ error: "Provide at least 3 characters to search" }, { status: 400 });
    }
    const topN = typeof body.topN === "number" ? Math.min(Math.max(Math.round(body.topN), 1), 8) : TOP_N;

    // Previously human-reviewed claims only — precedents must cite a human decision.
    const priorClaims = await db.claim.findMany({
      where: { verdict: { reviews: { some: {} } } },
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

    const matches = await engineSimilarList(text, candidates, topN, MIN_SIM);

    // enrich with candidate metadata (similarity comes from the engine)
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
    console.error("precedents-search-error", error);
    return NextResponse.json({ error: "Failed to search precedents" }, { status: 500 });
  }
}
