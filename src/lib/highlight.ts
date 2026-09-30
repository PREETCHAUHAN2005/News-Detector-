/**
 * Claim-term highlighting utilities (BR-03 evidence-first).
 *
 * The Python engine returns, for each retrieved evidence, the terms shared
 * between the claim and the statement — drawn from the production TF-IDF
 * vocabulary and ranked by IDF. Those explain WHY a piece of evidence was
 * retrieved and are rendered as excerpt highlights.
 *
 * `sharedTerms` is a pure TS fallback for legacy rows (and BR-08 reused
 * evidence) stored before the engine emitted `highlights`: a stopword-filtered
 * lexical overlap between the claim and the excerpt.
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

/** Normalize an engine `highlights` value (JSON string | array | null) to a term list. */
export function normalizeHighlights(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string" && t.length > 0);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [];
    } catch {
      return [];
    }
  }
  return [];
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

/** Effective highlight terms for one evidence row: engine terms preferred, fallback for legacy. */
export function effectiveHighlightTerms(
  raw: string | string[] | null | undefined,
  claim: string,
  excerpt: string
): string[] {
  const stored = normalizeHighlights(raw);
  return stored.length > 0 ? stored : sharedTerms(claim, excerpt);
}

/** Split a text into [text, isMatch] segments for the given highlight terms. */
export function segmentHighlighted(
  text: string,
  terms: string[]
): Array<{ text: string; match: boolean }> {
  const usable = terms
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 12);
  if (usable.length === 0) return [{ text, match: false }];
  const escaped = usable
    .sort((a, b) => b.length - a.length) // longest first so bigrams win over subsumed unigrams
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(`(?:${escaped})`, "giu");
  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ text: text.slice(lastIndex, m.index), match: false });
    segments.push({ text: m[0], match: true });
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) pattern.lastIndex += 1; // safety against zero-length matches
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), match: false });
  return segments;
}
