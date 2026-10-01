"use client";
/** Typed client-side API helpers (all same-origin, session-authenticated). */
import type {
  AnalysisDTO,
  AnalyticsDTO,
  AppealDTO,
  AuditLogDTO,
  ModelCardDTO,
  SuggestionDTO,
  TrustedSourceDTO,
} from "@/types/api";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface AnalyzeResponse {
  analysis: AnalysisDTO;
  reused?: boolean;
  degraded?: boolean;
}

export function analyzeText(text: string, url?: string) {
  return jsonFetch<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ text, url: url || undefined }),
  });
}

export interface AnalysesListResponse {
  analyses: AnalysisDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export function fetchAnalyses(params: {
  status?: string;
  label?: string;
  q?: string;
  highImpact?: string;
  /** fairness drill-down (BR-17): exact topic match */
  topic?: string;
  /** queue ordering: newest (default) | oldest | high_impact */
  sort?: string;
  page?: number;
  pageSize?: number;
}) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.label) search.set("label", params.label);
  if (params.q) search.set("q", params.q);
  if (params.highImpact) search.set("highImpact", params.highImpact);
  if (params.topic) search.set("topic", params.topic);
  if (params.sort) search.set("sort", params.sort);
  search.set("page", String(params.page ?? 1));
  search.set("pageSize", String(params.pageSize ?? 20));
  return jsonFetch<AnalysesListResponse>(`/api/analyses?${search.toString()}`);
}

export function fetchAnalysis(id: string) {
  return jsonFetch<{ analysis: AnalysisDTO }>(`/api/analyses/${id}`);
}

export interface SimilarClaimDTO {
  claimId: string;
  analysisId: string;
  text: string;
  /** human-confirmed label from the prior review */
  finalLabel: string;
  /** char-channel cosine similarity (advisory — not the BR-08 reuse gate) */
  similarity: number;
  reviewedAt: string;
  reviewerName: string | null;
}

export interface SimilarAnalysesResponse {
  matches: SimilarClaimDTO[];
  /** how many human-verified claims were checked — powers the reassurance note */
  checkedCount: number;
  /** per-claim precedent groups (multi-claim inputs only; advisory) */
  claimMatches?: {
    claimId: string;
    position: number;
    text: string;
    matches: SimilarClaimDTO[];
  }[];
}

export function fetchSimilarAnalyses(id: string) {
  return jsonFetch<SimilarAnalysesResponse>(`/api/analyses/${id}/similar`);
}

/** Search precedents by free text (no analysis created, nothing persisted). */
export function searchPrecedents(text: string) {
  return jsonFetch<SimilarAnalysesResponse>("/api/precedents", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function submitReview(body: {
  verdictId: string;
  action: "accept" | "edit" | "reject";
  finalLabel?: string;
  notes?: string;
}) {
  return jsonFetch<{
    review: { id: string; finalLabel: string | null; round: number };
    status: string;
    needsSecondReview: boolean;
  }>("/api/reviews", { method: "POST", body: JSON.stringify(body) });
}

export function fileAppeal(body: {
  verdictId: string;
  appellantName: string;
  appellantEmail?: string;
  reason: string;
}) {
  return jsonFetch<{ appeal: AppealDTO }>("/api/appeals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchAppeals(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return jsonFetch<{ appeals: AppealDTO[] }>(`/api/appeals${qs}`);
}

export function resolveAppeal(id: string, status: string, resolutionNotes?: string) {
  return jsonFetch<{ appeal: AppealDTO }>(`/api/appeals/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolutionNotes }),
  });
}

export function fetchAnalytics(days?: number) {
  const qs = typeof days === "number" ? `?days=${days}` : "";
  return jsonFetch<AnalyticsDTO>(`/api/analytics${qs}`);
}

export function fetchAudit(
  params: { action?: string; entityType?: string; page?: number; pageSize?: number }
) {
  const search = new URLSearchParams();
  if (params.action) search.set("action", params.action);
  if (params.entityType) search.set("entityType", params.entityType);
  search.set("page", String(params.page ?? 1));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  return jsonFetch<{
    logs: AuditLogDTO[];
    total: number;
    page: number;
    pageSize: number;
    availableActions: string[];
  }>(`/api/audit?${search.toString()}`);
}

export function fetchSources() {
  return jsonFetch<{ sources: TrustedSourceDTO[] }>("/api/sources");
}

export function upsertSource(body: {
  name: string;
  domain: string;
  category: string;
  reliabilityScore: number;
  notes?: string;
}) {
  return jsonFetch<{ source: TrustedSourceDTO }>("/api/sources", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function submitFeedback(body: {
  verdictId: string;
  agree: boolean;
  correctedLabel?: string;
  notes?: string;
}) {
  return jsonFetch<{ feedback: { id: string } }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchModelCard() {
  return jsonFetch<ModelCardDTO>("/api/model-card");
}

export function fetchHealth() {
  return jsonFetch<{ status: string; database: string; nlpEngine: string }>("/api/health");
}

/** Engine suggestions come through the model-card proxy. */
export async function fetchSuggestions(): Promise<SuggestionDTO[]> {
  try {
    const data = await fetchModelCard();
    const card = data.card as { suggestions?: SuggestionDTO[] } | null;
    return card?.suggestions ?? [];
  } catch {
    return [];
  }
}
