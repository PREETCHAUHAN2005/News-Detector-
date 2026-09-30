/**
 * Claim-term highlighting utilities (BR-03 evidence-first).
 *
 * The Python engine returns, for each retrieved evidence, the terms shared
 * between the claim and the statement — drawn from the production TF-IDF
 * vocabulary and ranked by IDF, each with its IDF weight: {"term", "idf"}[].
 * Those explain WHY a piece of evidence was retrieved and are rendered as
 * excerpt highlights with weight tooltips (retrieval explainability).
 *
 * Legacy rows (and BR-08 reused evidence) stored before the engine emitted
 * weighted highlights persist a plain string[] — every consumer below
 * normalizes both shapes, and `sharedTerms` remains a pure TS fallback: a
 * stopword-filtered lexical overlap between the claim and the excerpt.
 */

/** Common English stopwords — keep in sync with the engine's stop_words="english" spirit. */
const STOPWORDS = new Set([
  "about", "after", "again", "against", "all", "also", "and", "any", "are", "because",
  "been", "before", "being", "below", "between", "both", "but", "came", "can", "cannot",
  "could", "did", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "into", "its", "itself", "just", "like", "made", "make",
  "many", "more", "most", "much", "must", "near", "need", "now", "off", "once",
  "only", "other", "our", "ours", "over", "own", "same", "shall", "she", "should",
  "since", "some", "such", "than", "that", "the", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "this", "those", "through", "too",
  "under", "until", "very", "was", "way", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "says", "said", "say",
]);

const MIN_TERM_LENGTH = 4;

/** One matched claim term with its IDF retrieval weight (when the engine supplied one). */
export interface HighlightDetail {
  term: string;
  idf?: number;
}

function isHighlightObject(value: unknown): value is { term: string; idf: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "term" in value &&
    typeof (value as { term: unknown }).term === "string"
  );
}

/** Coerce one raw entry (legacy string | engine object) to a HighlightDetail. */
function coerceDetail(value: unknown): HighlightDetail | null {
  if (typeof value === "string") return value.length > 0 ? { term: value } : null;
  if (isHighlightObject(value)) {
    return {
      term: value.term,
      idf:
        typeof value.idf === "number" && Number.isFinite(value.idf) ? value.idf : undefined,
    };
  }
  return null;
}

/** Normalize an engine `highlights` value (JSON string | array | null) to weighted details. */
export function normalizeHighlightDetails(
  raw: string | string[] | HighlightDetail[] | null | undefined
): HighlightDetail[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(coerceDetail)
    .filter((d): d is HighlightDetail => d !== null && d.term.length > 0);
}

/** Back-compat: term strings only (legacy callers, `usedStored` checks). */
export function normalizeHighlights(raw: string | string[] | null | undefined): string[] {
  return normalizeHighlightDetails(raw).map((d) => d.term);
}

/** Lexical claim∩excerpt overlap for legacy rows (stopword-filtered, longest-first). */
export function sharedTerms(claim: string, excerpt: string, limit = 8): string[] {
  const tokens = (text: string): Set<string> =>
    new Set(
      (text.toLowerCase().match(/\p{L}{2,}/gu) ?? []).filter(
        (t) => t.length >= MIN_TERM_LENGTH && !STOPWORDS.has(t)
      )
    );
  const overlap = [...tokens(claim)].filter((t) => tokens(excerpt).has(t));
  overlap.sort((a, b) => b.length - a.length);
  return overlap.slice(0, limit);
}

/** Effective weighted highlight terms: engine details preferred, lexical fallback for legacy rows. */
export function effectiveHighlightDetails(
  raw: string | string[] | HighlightDetail[] | null | undefined,
  claim: string,
  excerpt: string
): HighlightDetail[] {
  const stored = normalizeHighlightDetails(raw);
  if (stored.length > 0) return stored;
  return sharedTerms(claim, excerpt).map((term) => ({ term }));
}

/** Term strings only (report export + callers that don't need weights). */
export function effectiveHighlightTerms(
  raw: string | string[] | null | undefined,
  claim: string,
  excerpt: string
): string[] {
  return effectiveHighlightDetails(raw, claim, excerpt).map((d) => d.term);
}

export interface HighlightSegment {
  text: string;
  match: boolean;
  /** the matched term (surface form may differ in case) — present on match segments */
  term?: string;
  /** IDF retrieval weight of the matched term (engine rows only) */
  idf?: number;
}

/** Split a text into [text, isMatch] segments for the given highlight terms. */
export function segmentHighlighted(
  text: string,
  terms: string[] | HighlightDetail[]
): HighlightSegment[] {
  const details: HighlightDetail[] = terms.map((t) =>
    typeof t === "string" ? { term: t } : t
  );
  const usable = details
    .map((d) => ({ term: d.term.trim(), idf: d.idf }))
    .filter((d) => d.term.length >= 3)
    .slice(0, 12);
  if (usable.length === 0) return [{ text, match: false }];
  // lowercase term → detail lookup so regex matches can recover their weight
  const byLower = new Map(usable.map((d) => [d.term.toLowerCase(), d]));
  const escaped = usable
    .sort((a, b) => b.term.length - a.term.length) // longest first so bigrams win over subsumed unigrams
    .map((d) => d.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(`(?:${escaped})`, "giu");
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ text: text.slice(lastIndex, m.index), match: false });
    const detail = byLower.get(m[0].toLowerCase());
    segments.push({
      text: m[0],
      match: true,
      term: detail?.term,
      idf: detail?.idf,
    });
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) pattern.lastIndex += 1; // safety against zero-length matches
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), match: false });
  return segments;
}
