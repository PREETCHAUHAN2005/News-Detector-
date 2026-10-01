/**
 * Veritas shared taxonomy — mirrors mini-services/nlp-engine/app/taxonomy.py.
 * Single source of truth for labels, display names, colors and helpers.
 */

export const TAXONOMY = {
  SUPPORTED: "Supported",
  CONTRADICTED: "Contradicted",
  MISLEADING: "Misleading",
  UNVERIFIED: "Unverified",
  NOT_ASSESSABLE: "NotAssessable",
} as const;

export type VerdictLabel = (typeof TAXONOMY)[keyof typeof TAXONOMY];

export const ALL_LABELS: VerdictLabel[] = [
  TAXONOMY.SUPPORTED,
  TAXONOMY.CONTRADICTED,
  TAXONOMY.MISLEADING,
  TAXONOMY.UNVERIFIED,
  TAXONOMY.NOT_ASSESSABLE,
];

export const LABEL_META: Record<
  VerdictLabel,
  { display: string; short: string; description: string; className: string; dot: string }
> = {
  [TAXONOMY.SUPPORTED]: {
    display: "Supported",
    short: "Supported",
    description: "Retrieved evidence supports the claim.",
    className: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
    dot: "bg-emerald-400",
  },
  [TAXONOMY.CONTRADICTED]: {
    display: "Contradicted",
    short: "Contradicted",
    description: "Retrieved evidence contradicts the claim.",
    className: "text-rose-400 border-rose-500/40 bg-rose-500/10",
    dot: "bg-rose-400",
  },
  [TAXONOMY.MISLEADING]: {
    display: "Misleading / Missing Context",
    short: "Misleading",
    description: "Evidence rates similar claims half-true or missing key context.",
    className: "text-amber-400 border-amber-500/40 bg-amber-500/10",
    dot: "bg-amber-400",
  },
  [TAXONOMY.UNVERIFIED]: {
    display: "Unverified — Insufficient Evidence",
    short: "Unverified",
    description: "Evidence was insufficient to responsibly assess the claim (abstained by design).",
    className: "text-zinc-400 border-zinc-500/40 bg-zinc-500/10",
    dot: "bg-zinc-400",
  },
  [TAXONOMY.NOT_ASSESSABLE]: {
    display: "Opinion / Satire (not assessable)",
    short: "Not assessable",
    description: "Opinions, satire and predictions are excluded from truth assessment.",
    className: "text-teal-300 border-teal-500/40 bg-teal-500/10",
    dot: "bg-teal-300",
  },
};

export function isVerdictLabel(x: string): x is VerdictLabel {
  return (ALL_LABELS as string[]).includes(x);
}

export const REVIEWER_ROLES = ["reviewer", "senior_reviewer", "admin"];
export const SENIOR_ROLES = ["senior_reviewer", "admin"];
export const ROLE_DISPLAY: Record<string, string> = {
  viewer: "Viewer",
  reviewer: "Reviewer",
  senior_reviewer: "Senior Reviewer",
  admin: "Administrator",
};
