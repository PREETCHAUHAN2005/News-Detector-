"use client";
/** Verdict badge — graded taxonomy, icon + text (never colour alone, WCAG). */
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, MessageSquareQuote } from "lucide-react";
import { cn } from "@/lib/utils";
import { LABEL_META, VerdictLabel, isVerdictLabel } from "@/lib/taxonomy";

const ICONS = {
  Supported: CheckCircle2,
  Contradicted: XCircle,
  Misleading: AlertTriangle,
  Unverified: HelpCircle,
  NotAssessable: MessageSquareQuote,
} as const;

export function VerdictBadge({
  label,
  size = "md",
  className,
}: {
  label: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!label || !isVerdictLabel(label)) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 text-zinc-400",
          size === "sm" && "px-2 py-0.5 text-[11px]",
          size === "md" && "px-2.5 py-1 text-xs",
          size === "lg" && "px-3 py-1.5 text-sm",
          className
        )}
      >
        <span className="size-1.5 rounded-full bg-zinc-500" />
        No verdict
      </span>
    );
  }
  const meta = LABEL_META[label as VerdictLabel];
  const Icon = ICONS[label as VerdictLabel];
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        meta.className,
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-2.5 py-1 text-xs",
        size === "lg" && "px-3.5 py-1.5 text-sm",
        className
      )}
    >
      <Icon className={cn(size === "sm" ? "size-3" : "size-3.5")} aria-hidden />
      {size === "sm" ? meta.short : meta.display}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_review: { label: "Awaiting review", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
    in_review: { label: "In review", cls: "text-teal-300 border-teal-500/40 bg-teal-500/10" },
    reviewed: { label: "Reviewed", cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
    appealed: { label: "Appealed", cls: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  };
  const m = map[status] ?? { label: status, cls: "text-zinc-400 border-zinc-600 bg-zinc-800/60" };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", m.cls)}>
      {m.label}
    </span>
  );
}
