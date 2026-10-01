/**
 * Server-side client for the Python NLP engine (port 8001).
 * All calls are fail-safe: timeouts and errors degrade to "Unverified"
 * and route the item to the human review queue (BRD §6.8) — never to a
 * confident verdict.
 *
 * SUPERVISION: the sandbox reaps background processes spawned from tool
 * shells, so the engine cannot be kept alive by an external watchdog.
 * `ensureEngine()` therefore runs INSIDE this Next.js server process
 * (the platform keeps port 3000 alive): it probes /healthz and, when the
 * engine is down, re-spawns it as a detached child of this process.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { TAXONOMY } from "@/lib/taxonomy";

const NLP_BASE = process.env.NLP_ENGINE_URL ?? "http://127.0.0.1:8001";
const ENGINE_DIR = join(process.cwd(), "mini-services", "nlp-engine");

/** append fd for the supervised engine's output (opened once, kept open) */
const engineLogFd = openSync(join(ENGINE_DIR, "engine.log"), "a");

let engineBootPromise: Promise<void> | null = null;

async function engineHealthyFast(): Promise<boolean> {
  const res = await fetchWithTimeout(`${NLP_BASE}/healthz`, { method: "GET" }, 1500);
  return Boolean(res?.ok);
}

/** Spawn the engine as a detached child of this Next.js process, wait for warmup. */
async function bootEngine(): Promise<void> {
  try {
    const child = spawn("bun", ["run", "start"], {
      cwd: ENGINE_DIR,
      detached: true,
      stdio: ["ignore", engineLogFd, engineLogFd],
    });
    child.unref();
  } catch {
    // spawn failure — the fail-safe path below handles an unreachable engine
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await engineHealthyFast()) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** Self-healing engine supervisor — safe to call on every critical engine use. */
export async function ensureEngine(): Promise<void> {
  try {
    if (await engineHealthyFast()) return;
    if (!engineBootPromise) {
      engineBootPromise = bootEngine().finally(() => {
        engineBootPromise = null;
      });
    }
    await engineBootPromise;
  } catch {
    // supervision must never break the caller — fail-safe degradation applies
  }
}

export interface EngineHighlightTerm {
  /** shared claim∩statement term from the engine's TF-IDF vocabulary */
  term: string;
  /** IDF weight of the term — retrieval strength, surfaced as hover tooltips */
  idf: number;
}

export interface EngineEvidence {
  rank: number;
  title: string;
  url: string;
  excerpt: string;
  similarity: number;
  kbRating: string;
  speaker?: string;
  speakerJob?: string;
  context?: string;
  subject?: string;
  /** claim∩statement terms (engine TF-IDF vocabulary, idf-ranked) */
  highlights?: EngineHighlightTerm[];
}

export interface EngineVerdict {
  label: string;
  confidence: number | null;
  abstained: boolean;
  reason: string;
  explanation: string;
  provisional: boolean;
  timeSensitivity?: { temporalMarkers: boolean; fastChangingSubject: boolean; fastChangingTerms: string[] };
  evidenceAgeDays: number | null;
  styleSignals?: Record<string, unknown>;
  sourceReliability: number | null;
  evidence: EngineEvidence[];
}

export interface EngineClaim {
  position: number;
  text: string;
  claimType: string;
  assessable: boolean;
  typeReason: string;
  verdict: EngineVerdict;
}

export interface EngineAnalysis {
  modelVersion: string;
  dataVersion: string;
  latencyMs: number;
  degraded?: boolean;
  degradationReason?: string;
  sanitization: { flags: string[]; originalLength: number; sanitizedLength: number };
  claims: EngineClaim[];
  highImpact: { flag: boolean; categories: string[]; matchedTerms: string[] };
  overall: { label: string; confidence: number | null };
}

export interface SimilarMatch {
  id?: string;
  /** claim id (precedent panel candidates) */
  claimId?: string;
  analysisId?: string;
  text?: string;
  finalLabel?: string;
  similarity?: number;
  /** Prisma Date serializes to ISO string over the wire; server-side calls pass Date */
  reviewedAt?: string | Date;
  reviewerName?: string | null;
}

export interface EngineSegmentedClaim {
  position: number;
  text: string;
  claimType: string;
  assessable: boolean;
}

const DEGRADED: EngineAnalysis = {
  modelVersion: "unavailable",
  dataVersion: "unavailable",
  latencyMs: 0,
  degraded: true,
  degradationReason: "NLP engine unreachable",
  sanitization: { flags: ["engine_unavailable"], originalLength: 0, sanitizedLength: 0 },
  claims: [],
  highImpact: { flag: false, categories: [], matchedTerms: [] },
  overall: { label: TAXONOMY.UNVERIFIED, confidence: 0 },
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function engineHealth(): Promise<{ ok: boolean; kbSize: number }> {
  const res = await fetchWithTimeout(`${NLP_BASE}/healthz`, { method: "GET" }, 4000);
  if (!res || !res.ok) return { ok: false, kbSize: 0 };
  try {
    const data = (await res.json()) as { ready?: boolean };
    return { ok: data.ready === true, kbSize: 0 };
  } catch {
    return { ok: false, kbSize: 0 };
  }
}

export async function engineAnalyze(text: string, url?: string): Promise<EngineAnalysis> {
  // critical path: bring the engine up if it was reaped (see SUPERVISION above)
  await ensureEngine();
  const res = await fetchWithTimeout(
    `${NLP_BASE}/v1/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, url, topK: 5 }),
    },
    30_000
  );
  if (!res || !res.ok) return { ...DEGRADED };
  try {
    const data = (await res.json()) as EngineAnalysis;
    if (data.degraded) return { ...data };
    return data;
  } catch {
    return { ...DEGRADED };
  }
}

export async function engineSimilar(text: string, candidates: SimilarMatch[]): Promise<SimilarMatch | null> {
  const res = await fetchWithTimeout(
    `${NLP_BASE}/v1/similar`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, candidates }),
    },
    15_000
  );
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { match: SimilarMatch | null };
    return data.match ?? null;
  } catch {
    return null;
  }
}

/** Ranked similar-claim precedents for the dossier panel (advisory, never auto-applied). */
export async function engineSimilarList(
  text: string,
  candidates: SimilarMatch[],
  topN = 3,
  minSim = 0.3
): Promise<SimilarMatch[]> {
  const res = await fetchWithTimeout(
    `${NLP_BASE}/v1/similar`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, candidates, topN, minSim }),
    },
    15_000
  );
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as { matches?: SimilarMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

/**
 * Claim extraction only (no retrieval, no verdict) — lets the precedent search
 * split a pasted multi-claim article before the per-claim consistency sweep.
 * Fail-safe: engine unreachable → empty list (whole-text search still works).
 */
export async function engineSegment(text: string): Promise<EngineSegmentedClaim[]> {
  const res = await fetchWithTimeout(
    `${NLP_BASE}/v1/segment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    10_000
  );
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as { claims?: EngineSegmentedClaim[] };
    return Array.isArray(data.claims) ? data.claims : [];
  } catch {
    return [];
  }
}

export async function engineModelCard(): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(`${NLP_BASE}/v1/meta`, { method: "GET" }, 10_000);
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function engineEval(): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(`${NLP_BASE}/v1/eval`, { method: "GET" }, 120_000);
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
