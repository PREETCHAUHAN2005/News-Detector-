"use client";
/** App sidebar — Cursor-style navigation with recent analyses and profile. */
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck,
  ChartColumn,
  FileSearch,
  History,
  ScrollText,
  ShieldCheck,
  Sparkles,
  SquareLibrary,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore, ViewId } from "@/lib/store";
import { fetchAnalyses } from "@/lib/api";
import { cn } from "@/lib/utils";
import { VerdictBadge } from "@/components/verdict/verdict-badge";
import { VeritasLogo } from "@/components/veritas-logo";

const NAV: { id: ViewId; label: string; icon: typeof FileSearch; hint?: string }[] = [
  { id: "home", label: "Analyze", icon: Sparkles },
  { id: "review", label: "Review queue", icon: BookOpenCheck, hint: "queue" },
  { id: "analytics", label: "Analytics", icon: ChartColumn },
  { id: "appeals", label: "Appeals", icon: ScrollText },
  { id: "audit", label: "Audit log", icon: History },
  { id: "sources", label: "Sources", icon: SquareLibrary },
  { id: "model-card", label: "Model card", icon: ShieldCheck },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView, openAnalysis } = useAppStore();
  const queryClient = useQueryClient();

  const { data: recent } = useQuery({
    queryKey: ["sidebar-recent"],
    queryFn: () => fetchAnalyses({ pageSize: 6 }),
    staleTime: 15_000,
  });

  const go = (id: ViewId) => {
    setView(id);
    queryClient.invalidateQueries({ queryKey: ["sidebar-recent"] });
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <VeritasLogo className="size-7 shrink-0" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Veritas</p>
          <p className="text-[10px] text-zinc-500">NLP fact-checking workbench</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="space-y-0.5 px-2.5" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => go(item.id)}
            aria-current={view === item.id ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
              view === item.id
                ? "bg-zinc-800/90 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            )}
          >
            <item.icon className={cn("size-4", view === item.id ? "text-emerald-400" : "text-zinc-500")} aria-hidden />
            {item.label}
            {item.id === "review" && (
              <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">
                human
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Recent analyses */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col px-2.5">
        <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Recent analyses
        </p>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          {recent?.analyses.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                openAnalysis(a.id);
                onNavigate?.();
              }}
              className="group flex w-full flex-col items-start gap-1 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-zinc-800 hover:bg-zinc-800/50"
            >
              <span className="line-clamp-2 w-full text-[12px] leading-snug text-zinc-400 group-hover:text-zinc-200">
                {a.inputText}
              </span>
              <VerdictBadge label={a.overallLabel} size="sm" />
            </button>
          ))}
          {recent && recent.analyses.length === 0 && (
            <p className="px-2.5 text-[11px] text-zinc-600">No analyses yet.</p>
          )}
        </div>
      </div>

      {/* Trust note */}
      <div className="mx-2.5 mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          <FileSearch className="mb-1 size-3.5 text-emerald-400" aria-hidden />
          <br />
          Assisted by automation, confirmed by humans. Verdicts cite evidence and abstain
          when unsure.
        </p>
      </div>
    </div>
  );
}
