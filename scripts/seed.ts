/**
 * Veritas demo seed — users, trusted sources, engine-driven analyses,
 * reviews (incl. second rounds), appeals, feedback and audit trails.
 *
 * Run: bun run scripts/seed.ts   (NLP engine must be up on :8001)
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const ENGINE = "http://127.0.0.1:8001";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const USERS = [
  { email: "reviewer@veritas.io", name: "Priya Sharma", role: "reviewer", avatarColor: "emerald" },
  { email: "senior@veritas.io", name: "Marcus Chen", role: "senior_reviewer", avatarColor: "amber" },
  { email: "admin@veritas.io", name: "Avery Wallace", role: "admin", avatarColor: "rose" },
  { email: "viewer@veritas.io", name: "Sam Rivera", role: "viewer", avatarColor: "teal" },
];

const SOURCES = [
  { name: "PolitiFact", domain: "politifact.com", category: "fact_check", reliabilityScore: 0.9, notes: "Primary fact-check KB for v1 (LIAR corpus, 2007–2016 window)." },
  { name: "Snopes", domain: "snopes.com", category: "fact_check", reliabilityScore: 0.88, notes: "General-purpose fact-checking." },
  { name: "FactCheck.org", domain: "factcheck.org", category: "fact_check", reliabilityScore: 0.9, notes: "Annenberg Public Policy Center." },
  { name: "AP Fact Check", domain: "apnews.com", category: "wire_service", reliabilityScore: 0.92, notes: "Associated Press wire service." },
  { name: "Reuters Fact Check", domain: "reuters.com", category: "wire_service", reliabilityScore: 0.92, notes: "Reuters wire service." },
  { name: "WHO", domain: "who.int", category: "official_records", reliabilityScore: 0.95, notes: "World Health Organization official records." },
  { name: "U.S. Bureau of Labor Statistics", domain: "bls.gov", category: "official_records", reliabilityScore: 0.97, notes: "Employment and economic statistics." },
  { name: "Fed Register", domain: "federalregister.gov", category: "official_records", reliabilityScore: 0.95, notes: "U.S. federal government registry." },
  { name: "The Guardian US", domain: "theguardian.com", category: "news", reliabilityScore: 0.75, notes: "Reputable newspaper — supporting context only." },
];

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

// ── demo statements ── exact train facts (dup-reuse), test paraphrases, novel, opinion
const SEED_STATEMENTS: { text: string; kind: "train" | "test" | "novel" | "opinion" }[] = [
  { text: "Says the Annies List political group supports third-trimester abortions on demand.", kind: "train" },
  { text: "President Barack Obama took exactly none of his own deficit reduction commissions ideas. Not one.", kind: "train" },
  { text: "In just 17 years, spending for Social Security, federal health care and interest on the debt will consume all tax revenue.", kind: "train" },
  { text: "There are a lot of casinos across the country that have gone bankrupt.", kind: "train" },
  { text: "Under President Obamas health-care reforms, the premium for an average plan will go up $10,000 per family.", kind: "train" },
  { text: "In the case of a catastrophic event, the Atlanta-area offices of the Centers for Disease Control and Prevention would be forced to shut down.", kind: "train" },
  { text: "Says Mitt Romneys budget plan would raise taxes on middle-class families with children by more than $2,000 a year.", kind: "train" },
  { text: "Half of all illegal immigrants in America pay federal income taxes.", kind: "train" },
  { text: "Says Rick Perry doubled state debt and left taxpayers with a $27 billion budget deficit.", kind: "train" },
  { text: "The United States spends more on its military than the next 12 countries combined.", kind: "train" },
  { text: "Women earn 77 cents for every dollar a man earns for doing the same work.", kind: "test" },
  { text: "Says the Obama administration spent $700 billion in taxpayer money to bail out the auto industry.", kind: "test" },
  { text: "The national unemployment rate has dropped to its lowest point since the recession began.", kind: "test" },
  { text: "Nine of the 10 poorest states are Republican-led.", kind: "test" },
  { text: "Health care reform legislation is likely to cause small businesses to shut down because of the taxes and regulations.", kind: "test" },
  { text: "Says every family in America will pay $2,000 more per year in energy costs under the new climate rules.", kind: "test" },
  { text: "Says the federal minimum wage has not been raised in over a decade while Congress voted itself multiple pay raises.", kind: "test" },
  { text: "Says childhood vaccinations are linked to autism in a study of 12 children.", kind: "novel" },
  { text: "A secret government facility in Nevada has developed technology to control the weather using electromagnetic waves.", kind: "novel" },
  { text: "Drinking lemon juice daily cures cancer in 80 percent of patients, according to doctors.", kind: "novel" },
  { text: "The new infrastructure bill will ban all gasoline vehicles by 2026.", kind: "novel" },
  { text: "Electric vehicle sales in Norway surpassed 90 percent of all new car sales last quarter.", kind: "novel" },
  { text: "SHOCKING: The unemployment rate is at its lowest level in 30 years and nobody is talking about it!", kind: "novel" },
  { text: "I believe this administration has done more for working families than any in history, and everyone should recognize that.", kind: "opinion" },
  { text: "In my opinion, the tax plan is the worst piece of legislation in a generation.", kind: "opinion" },
  { text: "The Onion reports that Congress has voted to replace the entire healthcare system with a single vending machine.", kind: "opinion" },
  { text: "Scientists predict that artificial intelligence will replace most jobs by 2050.", kind: "opinion" },
  { text: "I think the governor has done a tremendous job and deserves reelection.", kind: "opinion" },
  { text: "I feel that the city council should invest more in public transit, and most residents agree with me.", kind: "opinion" },
  { text: "Says his opponent wants to raise taxes on every small business in the state. The unemployment rate in the state dropped to 4.2 percent last year, the lowest in two decades. Experts predict energy prices will rise next winter.", kind: "novel" },
  { text: "Says the state cut education funding by $1.3 billion while giving tax breaks to corporations. Says class sizes have doubled since 2010.", kind: "novel" },
  { text: "Immigrants are stealing jobs from American workers and nobody in Washington will do anything about it!", kind: "novel" },
  { text: "Says the senator voted against the veterans healthcare bill five times.", kind: "novel" },
  { text: "Reports claim the new voting law will disenfranchise millions of elderly voters across the country.", kind: "novel" },
  { text: "Says the rival candidate was endorsed by the largest teachers union in the state. Says the union represents over 40,000 educators.", kind: "novel" },
];

async function main() {
  console.log("Seeding Veritas…");

  // wipe operational tables (idempotent demo seed)
  await db.feedback.deleteMany();
  await db.appeal.deleteMany();
  await db.review.deleteMany();
  await db.evidence.deleteMany();
  await db.verdict.deleteMany();
  await db.claim.deleteMany();
  await db.analysis.deleteMany();
  await db.auditLog.deleteMany();
  await db.trustedSource.deleteMany();
  await db.user.deleteMany();

  // ── users ──
  const users = await Promise.all(
    USERS.map((u) =>
      db.user.create({ data: { ...u, passwordHash: hashPassword("veritas123") } })
    )
  );
  const [reviewer, senior, admin] = users;
  console.log(`users: ${users.length}`);

  // ── trusted sources ──
  const sources = await Promise.all(
    SOURCES.map((s) => db.trustedSource.create({ data: s }))
  );
  const politifact = sources[0];
  console.log(`sources: ${sources.length}`);

  const now = Date.now();
  const hour = 3_600_000;

  let created = 0;
  const verdictsForAppeal: string[] = [];
  const verdictsForFeedback: string[] = [];

  for (let i = 0; i < SEED_STATEMENTS.length; i++) {
    const item = SEED_STATEMENTS[i];
    const createdAt = new Date(now - (SEED_STATEMENTS.length - i) * 4.6 * hour); // spread over ~7 days
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
        status: "pending_review",
        overallLabel: result.overall.label,
        overallConfidence: result.overall.confidence ?? 0,
        highImpact: result.highImpact.flag,
        modelVersion: result.modelVersion,
        latencyMs: result.latencyMs,
        topic: topic === "General" ? null : topic,
        createdAt,
        submittedById: users[i % 4].id,
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
                styleSignals: c.verdict.styleSignals
                  ? JSON.stringify(c.verdict.styleSignals)
                  : null,
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

    // ── reviews on most analyses (older ones reviewed, newest pending) ──
    const ageHours = (now - createdAt.getTime()) / hour;
    if (ageHours > 8 && analysis.claims.length > 0 && analysis.claims[0].verdict) {
      const verdict = analysis.claims[0].verdict;
      const roll = (i * 7 + 3) % 10;
      let action: "accept" | "edit" | "reject" = "accept";
      if (roll === 1) action = "edit";
      if (roll === 6 && analysis.overallLabel === "Unverified") action = "reject";

      const reviewerUser = i % 2 === 0 ? reviewer : senior;
      const finalLabel =
        action === "accept"
          ? verdict.label
          : action === "edit"
            ? (["Supported", "Misleading", "Unverified", "Contradicted"] as const)[
                (i + 1) % 4
              ]
            : "Unverified";

      await db.review.create({
        data: {
          verdictId: verdict.id,
          reviewerId: reviewerUser.id,
          round: 1,
          action,
          finalLabel,
          notes:
            action === "accept"
              ? "Evidence and confidence support the recommendation."
              : action === "edit"
                ? "Retrieved evidence covers only part of the claim — adjusted label after reviewing the citation."
                : "Model abstained but the retrieved evidence is not on-topic; sending back as insufficient.",
          createdAt: new Date(createdAt.getTime() + 2 * hour),
        },
      });

      let status = "reviewed";
      if (analysis.highImpact) {
        // BR-12: high-impact needs a second (senior) review
        await db.review.create({
          data: {
            verdictId: verdict.id,
            reviewerId: senior.id,
            round: 2,
            action: "accept",
            finalLabel,
            notes: "Second review (mandatory for high-impact): confirmed with sources.",
            createdAt: new Date(createdAt.getTime() + 5 * hour),
          },
        });
      } else if (i % 3 === 0) {
        status = "in_review";
      }

      await db.analysis.update({ where: { id: analysis.id }, data: { status } });
      await db.auditLog.create({
        data: {
          action: "review_submitted",
          entityType: "verdict",
          entityId: verdict.id,
          actorId: reviewerUser.id,
          detail: JSON.stringify({ analysisId: analysis.id, action, round: 1, finalLabel, highImpact: analysis.highImpact }),
          createdAt: new Date(createdAt.getTime() + 2 * hour),
        },
      });

      if (ageHours > 30) verdictsForAppeal.push(verdict.id);
      if (ageHours > 16) verdictsForFeedback.push(verdict.id);
    }
  }
  console.log(`analyses: ${created}`);

  // ── appeals (BR-14) ──
  const appealSpecs = [
    { name: "Dana Whitfield", email: "dana.w@example.com", reason: "The claim was quoted out of context from our organization's full statement, and the cited fact-check addresses a different version of the claim.", status: "open" },
    { name: "Press Office — Rep. L. Alvarez", email: "press@alvarez.example.gov", reason: "The figure cited refers to a different fiscal year. Updated official statistics were published after the assessment.", status: "in_review" },
    { name: "Community Health Network", email: "media@chn.example.org", reason: "The health statistic was mischaracterized; our published data supports a different conclusion.", status: "resolved_upheld" },
    { name: "Jordan Blake (campaign)", email: "jordan.blake.example@campaign.org", reason: "The endorsement claim was withdrawn after our statement; ruling should reflect the correction.", status: "resolved_overturned" },
  ];
  for (let i = 0; i < appealSpecs.length && i < verdictsForAppeal.length; i++) {
    const spec = appealSpecs[i];
    const verdictId = verdictsForAppeal[i];
    const createdAt = new Date(now - (5 - i) * 18 * hour);
    const appeal = await db.appeal.create({
      data: {
        verdictId,
        appellantName: spec.name,
        appellantEmail: spec.email,
        reason: spec.reason,
        status: spec.status,
        createdAt,
        resolvedAt: spec.status.startsWith("resolved") ? new Date(createdAt.getTime() + 22 * hour) : null,
        resolverId: spec.status.startsWith("resolved") ? senior.id : null,
        resolutionNotes: spec.status.startsWith("resolved")
          ? spec.status === "resolved_upheld"
            ? "Reviewed against cited evidence; original assessment stands with documentation."
            : "Appellant provided a verifiable correction; analysis re-opened for re-review."
          : null,
      },
    });
    await db.auditLog.create({
      data: {
        action: "appeal_filed",
        entityType: "appeal",
        entityId: appeal.id,
        detail: JSON.stringify({ verdictId, appellantName: spec.name }),
        createdAt,
      },
    });
    if (spec.status.startsWith("resolved")) {
      await db.auditLog.create({
        data: {
          action: "appeal_resolved",
          entityType: "appeal",
          entityId: appeal.id,
          actorId: senior.id,
          detail: JSON.stringify({ status: spec.status }),
          createdAt: new Date(createdAt.getTime() + 22 * hour),
        },
      });
    }
  }
  console.log(`appeals: ${Math.min(appealSpecs.length, verdictsForAppeal.length)}`);

  // ── reviewer feedback (BR-15) ──
  for (let i = 0; i < verdictsForFeedback.length; i += 2) {
    const verdictId = verdictsForFeedback[i];
    await db.feedback.create({
      data: {
        verdictId,
        reviewerId: i % 2 === 0 ? reviewer.id : senior.id,
        agree: i % 4 !== 0,
        correctedLabel: i % 4 === 0 ? "Misleading" : null,
        notes: i % 4 === 0 ? "Evidence matched partially; label should reflect missing context." : null,
      },
    });
  }
  console.log(`feedback: ${Math.ceil(verdictsForFeedback.length / 2)}`);

  // ── source audit sample (BR-03 registry governance) ──
  await db.auditLog.create({
    data: {
      action: "source_updated",
      entityType: "trusted_source",
      entityId: politifact.id,
      actorId: admin.id,
      detail: JSON.stringify({ note: "Initial registry import approved by editorial leadership." }),
    },
  });

  const counts = {
    analyses: await db.analysis.count(),
    claims: await db.claim.count(),
    verdicts: await db.verdict.count(),
    evidence: await db.evidence.count(),
    reviews: await db.review.count(),
    appeals: await db.appeal.count(),
    feedback: await db.feedback.count(),
    audit: await db.auditLog.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
