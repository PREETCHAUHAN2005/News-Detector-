/**
 * POST /api/analyze — the ingestion + verification workflow (BR-01…BR-09).
 *
 * Pipeline: validate → rate-limit → near-duplicate reuse check (BR-08) →
 * engine analysis → persistence (Analysis/Claims/Verdicts/Evidence) → audit.
 *
 * Fail-safe (BRD §6.8): if the NLP engine is unreachable, the analysis is
 * still filed as "Unverified" and routed to the human review queue — never
 * to a confident verdict.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { engineAnalyze, engineSimilar } from "@/lib/nlp-client";
import { TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().min(1, "Input text is required").max(60_000),
  url: z.string().url().max(2_000).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  try {
    // AUTH_LOGIN_ENABLED=false → getSessionUser falls back to the demo reviewer,
    // so this 401 only fires once the login feature is re-enabled.
    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Sign in to run analyses" }, { status: 401 });
    }

    const ip = clientIp(req);
    const userId = user.id ?? "unknown";
    const rl = rateLimit(`analyze:${userId}:${ip}`, 8, 8);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Rate limit exceeded — please retry shortly", retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { text, url } = parsed.data;

    // ── BR-08: near-duplicate reuse of previously reviewed claims ──
    const priorClaims = await db.claim.findMany({
      where: { verdict: { reviews: { some: {} } } },
      select: {
        id: true,
        text: true,
        analysisId: true,
        verdict: {
          select: {
            label: true,
            reviews: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { finalLabel: true },
            },
          },
        },
      },
      take: 400,
    });
    const candidates = priorClaims
      .filter((c) => c.verdict?.reviews?.[0]?.finalLabel)
      .map((c) => ({
        id: c.id,
        analysisId: c.analysisId,
        text: c.text,
        finalLabel: c.verdict!.reviews![0].finalLabel!,
      }));

    let duplicate: Awaited<ReturnType<typeof engineSimilar>> = null;
    if (candidates.length > 0) {
      duplicate = await engineSimilar(text, candidates);
    }

    const politifact = await db.trustedSource.findUnique({ where: { name: "PolitiFact" } });

    // ── Duplicate-reuse path (BR-08) ──
    if (duplicate) {
      const priorClaim = priorClaims.find((c) => c.id === duplicate!.id);
      const priorAnalysisId = priorClaim?.analysisId;
      const reusedLabel = duplicate.finalLabel!;
      // carry the prior verdict's citations so the dossier stays evidence-first
      const priorVerdictEvidence = await db.evidence.findMany({
        where: { verdict: { claimId: duplicate.id } },
        orderBy: { rank: "asc" },
      });
      const analysis = await db.analysis.create({
        data: {
          inputText: text,
          inputUrl: url || null,
          status: "pending_review",
          overallLabel: reusedLabel,
          overallConfidence: 0.93,
          highImpact: true, // reused verdicts still get human confirmation
          duplicateOfId: priorAnalysisId,
          duplicateSimilarity: duplicate.similarity ?? 0.9,
          modelVersion: "reuse-prior-human-verdict",
          latencyMs: 0,
          claims: {
            create: {
              position: 0,
              text,
              claimType: "factual",
              assessable: true,
              verdict: {
                create: {
                  label: reusedLabel,
                  confidence: 0.93,
                  abstained: false,
                  explanation: `A near-duplicate claim (${Math.round((duplicate.similarity ?? 0.9) * 100)}% similar) was previously reviewed and human-verified as "${reusedLabel}". Per BR-08 we reuse the existing human verdict instead of re-guessing. The citations below come from that prior review.`,
                  provisional: false,
                  modelVersion: "reuse-prior-human-verdict",
                  sourceReliability: politifact?.reliabilityScore ?? null,
                  evidence: {
                    create: priorVerdictEvidence.map((e) => ({
                      rank: e.rank,
                      title: e.title,
                      sourceId: e.sourceId ?? politifact?.id,
                      url: e.url,
                      excerpt: e.excerpt,
                      similarity: e.similarity,
                      kbRating: e.kbRating,
                      speaker: e.speaker,
                      context: e.context,
                    })),
                  },
                },
              },
            },
          },
        },
        include: { claims: { include: { verdict: true } } },
      });
      await audit(
        "dedup_reused",
        "analysis",
        analysis.id,
        {
          reusedLabel,
          similarity: duplicate.similarity,
          duplicateOf: priorAnalysisId,
        },
        userId
      );
      return NextResponse.json({ analysis, reused: true });
    }

    // ── Engine path ──
    const started = Date.now();
    const result = await engineAnalyze(text, url || undefined);
    const latencyMs = result.latencyMs || Date.now() - started;
    const degraded = Boolean(result.degraded);

    const analysis = await db.analysis.create({
      data: {
        inputText: text,
        inputUrl: url || null,
        status: "pending_review",
        overallLabel: result.overall.label,
        overallConfidence: result.overall.confidence ?? 0,
        highImpact: result.highImpact.flag,
        modelVersion: result.modelVersion,
        latencyMs,
        submittedById: userId,
        claims: {
          create: degraded
            ? [
                {
                  position: 0,
                  text: text.slice(0, 2000),
                  claimType: "factual",
                  assessable: true,
                  verdict: {
                    create: {
                      label: TAXONOMY.UNVERIFIED,
                      confidence: 0,
                      abstained: true,
                      explanation:
                        "The verification engine was unreachable while processing this input. Per our fail-safe policy the item is filed as Unverified and routed to a human reviewer (BRD §6.8).",
                      provisional: false,
                      modelVersion: "fail-safe",
                    },
                  },
                },
              ]
            : result.claims.map((c) => ({
                position: c.position,
                text: c.text,
                claimType: c.claimType,
                assessable: c.assessable,
                verdict: {
                  create: {
                    label: c.verdict.label,
                    confidence: c.verdict.confidence ?? 0,
                    abstained: c.verdict.abstained,
                    explanation: c.verdict.explanation,
                    provisional: c.verdict.provisional,
                    evidenceAgeDays: c.verdict.evidenceAgeDays,
                    styleSignals: c.verdict.styleSignals
                      ? JSON.stringify(c.verdict.styleSignals)
                      : null,
                    sourceReliability: c.verdict.sourceReliability,
                    modelVersion: result.modelVersion,
                    evidence: {
                      create: c.verdict.evidence.map((e) => ({
                        rank: e.rank,
                        title: e.title,
                        sourceId: politifact?.id,
                        url: e.url,
                        excerpt: e.excerpt,
                        similarity: e.similarity,
                        kbRating: e.kbRating,
                        speaker: e.speaker ?? null,
                        context: e.context ?? null,
                        // engine-computed claim∩statement terms (TF-IDF vocabulary)
                        highlights: e.highlights?.length ? JSON.stringify(e.highlights) : null,
                      })),
                    },
                  },
                },
              })),
        },
      },
      include: {
        claims: {
          include: {
            verdict: { include: { evidence: true, reviews: true } },
          },
        },
      },
    });

    // topic for fairness reports (BR-17): strongest evidence's subject
    const topic =
      result.claims
        .flatMap((c) => c.verdict?.evidence ?? [])
        .sort((a, b) => b.similarity - a.similarity)[0]?.subject ?? "General";
    if (topic !== "General" && analysis.id) {
      await db.analysis.update({ where: { id: analysis.id }, data: { topic } });
    }

    await audit(
      degraded ? "engine_degraded" : "analysis_created",
      "analysis",
      analysis.id,
      {
        overallLabel: analysis.overallLabel,
        overallConfidence: analysis.overallConfidence,
        highImpact: analysis.highImpact,
        latencyMs,
        modelVersion: result.modelVersion,
        sanitizationFlags: result.sanitization?.flags ?? [],
        claims: analysis.claims.length,
      },
      userId
    );

    return NextResponse.json({ analysis, degraded });
  } catch (error) {
    console.error("analyze-error", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
