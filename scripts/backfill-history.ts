/**
 * Veritas history backfill — adds demo analyses spread across 10–80 days ago
 * (with backdated reviews + audit entries) so the analytics date-range trends
 * and weekly volume buckets have realistic period-over-period data.
 *
 * Idempotent: skips if backfilled statements already exist.
 * Run: bun run scripts/backfill-history.ts   (NLP engine must be up on :8001)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ENGINE = "http://127.0.0.1:8001";

type EngineEvidence = {
  rank: number; title: string; url: string; excerpt: string;
  similarity: number; kbRating: string; speaker?: string; speakerJob?: string;
  context?: string; subject?: string;
};
type EngineClaim = {
  position: number; text: string; claimType: string; assessable: boolean; typeReason: string;
  verdict: {
    label: string; confidence: number | null; abstained: boolean; reason: string;
    explanation: string; provisional: boolean; evidenceAgeDays: number | null;
    styleSignals?: Record<string, unknown>; sourceReliability: number | null; evidence: EngineEvidence[];
  };
};
type EngineResult = {
  modelVersion: string; latencyMs: number; degraded?: boolean;
  sanitization: { flags: string[]; originalLength: number; sanitizedLength: number };
  claims: EngineClaim[];
  highImpact: { flag: boolean; categories: string[]; matchedTerms: string[] };
  overall: { label: string; confidence: number | null };
};

async function engineAnalyze(text: string): Promise<EngineResult | null> {
  try {
    const res = await fetch(`${ENGINE}/v1/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, topK: 5 }),
    });
    if (!res.ok) return null;
    return (await res.json()) as EngineResult;
  } catch {
    return null;
  }
}

/** KB statements (dup-reuse → real verdicts) + a few novel ones (abstention). */
const STATEMENTS: { text: string }[] = [
  { text: "Says Barack Obama was born in Kenya." },
  { text: "Says Mitt Romneys companies shipped jobs overseas." },
  { text: "Says 90 percent of budget deficits are due to President George W. Bushs policies." },
  { text: "Says the national debt has increased by 50 percent under Barack Obama." },
  { text: "Says Rick Perry doubled state debt in Texas." },
  { text: "Says the stimulus bill created zero jobs." },
  { text: "Says Sarah Palin said I can see Russia from my house." },
  { text: "Says Congress has an approval rating of 9 percent." },
  { text: "Says voter turnout in the last election was the lowest in 70 years." },
  { text: "Says the top 1 percent pay 40 percent of all federal taxes." },
  { text: "Claims a secret government facility in Nevada is testing weather-control technology on citizens." },
  { text: "Says drinking alkaline water cures cancer." },
  { text: "Says the Federal Reserve will introduce a digital currency next month." },
  { text: "A new study confirms that eating chocolate daily extends life by five years." },
];

const DAYS_AGO = [12, 15, 18, 22, 25, 28, 33, 37, 41, 45, 50, 55, 62, 70];

async function main() {
  const existing = await db.analysis.findFirst({
    where: { inputText: { startsWith: "Says the national debt has increased by 50 percent" } },
  });
  if (existing) {
    console.log("history backfill already present — nothing to do");
    return;
  }

  const users = await db.user.findMany();
  const reviewer = users.find((u) => u.role === "reviewer");
  const senior = users.find((u) => u.role === "senior_reviewer");
  const politifact = await db.trustedSource.findFirst({ where: { domain: "politifact.com" } });
  if (!politifact || !reviewer || !senior) {
    console.log("missing users/sources — run scripts/seed.ts first");
    return;
  }

  const now = Date.now();
  const day = 86_400_000;
  let created = 0;

  for (let i = 0; i < STATEMENTS.length; i++) {
    const item = STATEMENTS[i];
    const daysAgo = DAYS_AGO[i % DAYS_AGO.length] + (i % 3); // slight jitter
    const createdAt = new Date(now - daysAgo * day - (i % 5) * 3_600_000);

    const result = await engineAnalyze(item.text);
    if (!result) {
      console.log(`engine unavailable, skipping statement ${i}`);
      continue;
    }

    const topic =
      result.claims.flatMap((c) => c.verdict?.evidence ?? [])
        .sort((a, b) => b.similarity - a.similarity)[0]?.subject ?? "General";

    const analysis = await db.analysis.create({
      data: {
        inputText: item.text,
        status: "reviewed",
        overallLabel: result.overall.label,
        overallConfidence: result.overall.confidence ?? 0,
        highImpact: result.highImpact.flag,
        modelVersion: result.modelVersion,
        latencyMs: result.latencyMs,
        topic: topic === "General" ? null : topic,
        createdAt,
        submittedById: users[i % users.length].id,
        claims: {
          create: result.claims.map((c) => ({
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
                styleSignals: c.verdict.styleSignals ? JSON.stringify(c.verdict.styleSignals) : null,
                sourceReliability: c.verdict.sourceReliability,
                modelVersion: result.modelVersion,
                evidence: {
                  create: c.verdict.evidence.map((e) => ({
                    rank: e.rank,
                    title: e.title,
                    sourceId: politifact.id,
                    url: e.url,
                    excerpt: e.excerpt,
                    similarity: e.similarity,
                    kbRating: e.kbRating,
                    speaker: e.speaker ?? null,
                    context: e.context ?? null,
                  })),
                },
              },
            },
          })),
        },
      },
      include: { claims: { include: { verdict: true } } },
    });
    created++;

    await db.auditLog.create({
      data: {
        action: "analysis_created",
        entityType: "analysis",
        entityId: analysis.id,
        actorId: analysis.submittedById,
        detail: JSON.stringify({
          overallLabel: analysis.overallLabel,
          highImpact: analysis.highImpact,
          latencyMs: analysis.latencyMs,
          modelVersion: analysis.modelVersion,
          claims: analysis.claims.length,
        }),
        createdAt,
      },
    });

    // backdated human review on the first claim — accept mostly, one edit
    const firstVerdict = analysis.claims[0]?.verdict;
    if (firstVerdict) {
      const action = i === 4 ? "edit" : "accept";
      const reviewerUser = i % 2 === 0 ? reviewer : senior;
      const finalLabel =
        action === "edit"
          ? firstVerdict.label === "Unverified"
            ? "Misleading"
            : firstVerdict.label
          : firstVerdict.label;
      const reviewedAt = new Date(createdAt.getTime() + 6 * 3_600_000);
      await db.review.create({
        data: {
          verdictId: firstVerdict.id,
          reviewerId: reviewerUser.id,
          round: 1,
          action,
          finalLabel,
          notes:
            action === "edit"
              ? "Model abstained; strong evidence of cherry-picked statistics."
              : "Evidence confirms the recommendation.",
          createdAt: reviewedAt,
        },
      });
      await db.auditLog.create({
        data: {
          action: "review_submitted",
          entityType: "analysis",
          entityId: analysis.id,
          actorId: reviewerUser.id,
          detail: JSON.stringify({ round: 1, action, finalLabel }),
          createdAt: reviewedAt,
        },
      });
    }
  }

  console.log(`backfilled ${created} historical analyses (10–80 days old)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
