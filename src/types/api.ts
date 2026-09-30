/** Shared API DTO types (frontend ↔ /api routes). */

export type VerdictLabel =
  | "Supported"
  | "Contradicted"
  | "Misleading"
  | "Unverified"
  | "NotAssessable";

export interface SessionInfo {
  user?: { id?: string; name?: string | null; email?: string | null; role?: string };
  expires?: string;
}

export interface EvidenceDTO {
  id: string;
  rank: number;
  title: string;
  url: string;
  excerpt: string;
  similarity: number;
  kbRating: string;
  speaker?: string | null;
  context?: string | null;
  sourceId?: string | null;
  /** claim∩statement terms (engine TF-IDF, JSON string from DB or array) — excerpt
   *  highlights. Engine rows persist [{"term","idf"}]; legacy rows are string[]. */
  highlights?: string | string[] | Array<{ term: string; idf?: number }> | null;
  /** joined trusted-source registry row (BR-03) — present in dossier responses */
  source?: {
    id?: string;
    name?: string;
    domain?: string;
    category?: string;
    reliabilityScore?: number;
    approved?: boolean;
  } | null;
}

export interface ReviewDTO {
  id: string;
  verdictId: string;
  reviewerId: string;
  round: number;
  action: "accept" | "edit" | "reject";
  finalLabel: string | null;
  notes: string | null;
  createdAt: string;
  reviewer?: { id: string; name: string; role: string } | null;
}

export interface VerdictDTO {
  id: string;
  claimId: string;
  label: VerdictLabel;
  confidence: number;
  abstained: boolean;
  explanation: string;
  provisional: boolean;
  styleSignals?: string | null;
  sourceReliability?: number | null;
  modelVersion: string;
  evidence: EvidenceDTO[];
  reviews: ReviewDTO[];
}

export interface ClaimDTO {
  id: string;
  position: number;
  text: string;
  claimType: "factual" | "opinion" | "satire" | "prediction" | string;
  assessable: boolean;
  verdict: VerdictDTO | null;
}

export interface AnalysisDTO {
  id: string;
  inputText: string;
  inputUrl?: string | null;
  status: "pending_review" | "in_review" | "reviewed" | "appealed" | string;
  overallLabel: VerdictLabel | null;
  overallConfidence: number | null;
  highImpact: boolean;
  duplicateOfId?: string | null;
  duplicateSimilarity?: number | null;
  modelVersion?: string | null;
  latencyMs?: number | null;
  topic?: string | null;
  createdAt: string;
  submittedBy?: { id: string; name: string; role: string } | null;
  claims: ClaimDTO[];
}

export interface AppealDTO {
  id: string;
  verdictId: string;
  appellantName: string;
  appellantEmail?: string | null;
  reason: string;
  status: "open" | "in_review" | "resolved_upheld" | "resolved_overturned" | string;
  resolutionNotes?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  resolver?: { id: string; name: string; role: string } | null;
  verdict?: {
    claim?: { analysis?: { id: string; inputText: string; overallLabel: string | null } | null } | null;
  } | null;
}

export interface TrustedSourceDTO {
  id: string;
  name: string;
  domain: string;
  category: "fact_check" | "wire_service" | "official_records" | "news" | string;
  reliabilityScore: number;
  approved: boolean;
  notes?: string | null;
  updatedAt: string;
}

export interface AuditLogDTO {
  id: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail?: string | null;
  createdAt: string;
  actor?: { name: string; role: string } | null;
}

export interface TrendPoint {
  current: number;
  previous: number;
  /** relative fraction for counts/latency, absolute percentage points for rates */
  delta: number | null;
}

export interface AnalyticsDTO {
  /** Volume window for dailyVolume / rangeTotals (7/30/90, default 7). */
  days?: number;
  rangeTotals?: { analyses: number; reviews: number };
  /** Period-over-period KPI trends for the selected window. */
  trends?: {
    analyses: TrendPoint;
    reviews: TrendPoint;
    abstention: TrendPoint;
    override: TrendPoint;
    latencyP95: TrendPoint;
  };
  /** Daily analysis totals within the window (oldest → newest). */
  sparkline?: number[];
  totals: { analyses: number; reviews: number; appeals: number; reviewers: number };
  statusMix: Record<string, number>;
  verdictMix: Record<string, number>;
  abstentionRate: number;
  overrideRate: number;
  latency: { p50: number; p95: number; samples: number };
  reviewActions: Record<string, number>;
  appealMix: Record<string, number>;
  appealMedianResolutionHours: number | null;
  dailyVolume: { date: string; total: number; contradicted: number }[];
  fairnessByTopic: { topic: string; total: number; mix: Record<string, number>; contradictedShare: number }[];
}

export interface ModelCardDTO {
  card: Record<string, unknown> | null;
  evalResult: Record<string, unknown> | null;
  unavailable?: boolean;
  message?: string;
}

export interface SuggestionDTO {
  text: string;
  speaker: string;
  trueRating: string;
  hint: string;
  subject: string;
  kind: "fact_checked" | "novel" | string;
}

export function parseStyleSignals(json: string | null | undefined):
  | { sensationalism: number; emotional: number; hedging: number; clickbait: number; notes: string[] }
  | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return {
      sensationalism: Number(parsed.sensationalism ?? 0),
      emotional: Number(parsed.emotional ?? 0),
      hedging: Number(parsed.hedging ?? 0),
      clickbait: Number(parsed.clickbait ?? 0),
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return null;
  }
}

/** Effective label after human review (BR-11: reviewer decision is final). */
export function effectiveLabel(claim: ClaimDTO): {
  label: string | null;
  source: "human" | "model" | "none";
} {
  const reviews = claim.verdict?.reviews ?? [];
  if (reviews.length > 0) {
    const last = reviews[reviews.length - 1];
    return { label: last.finalLabel ?? null, source: "human" };
  }
  if (claim.verdict) return { label: claim.verdict.label, source: "model" };
  return { label: null, source: "none" };
}
