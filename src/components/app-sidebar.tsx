"use client";
/** App sidebar — Cursor-style navigation with recent analyses and profile. */
import { useSession } from "next-auth/react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NAV: {
  id: ViewId;
  label: string;
  icon: typeof FileSearch;
  hint?: string;
  /** g-key sequence for the jump-to-view shortcut */
  gKey?: string;
}[] = [
  { id: "home", label: "Analyze", icon: Sparkles, gKey: "h" },
  { id: "review", label: "Review queue", icon: BookOpenCheck, hint: "queue", gKey: "r" },
  { id: "analytics", label: "Analytics", icon: ChartColumn, gKey: "a" },
  { id: "appeals", label: "Appeals", icon: ScrollText, gKey: "e" },
  { id: "audit", label: "Audit log", icon: History, gKey: "u" },
  { id: "sources", label: "Sources", icon: SquareLibrary, gKey: "s" },
  { id: "model-card", label: "Model card", icon: ShieldCheck, gKey: "m" },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView, openAnalysis } = useAppStore();
  const queryClient = useQueryClient();
  // Both list queries need an authenticated /api/analyses call — gate them on
  // the session so they never fire (and stick in a 401 error state) pre-login.
  const { status: sessionStatus } = useSession();
  const authenticated = sessionStatus === "authenticated";

  const { data: recent } = useQuery({
    queryKey: ["sidebar-recent"],
    queryFn: () => fetchAnalyses({ pageSize: 6 }),
    staleTime: 15_000,
    enabled: authenticated,
  });

  // Live "action needed" count (BR-11): analyses awaiting their first human
  // decision. Key starts with "analyses" so every invalidation of the
  // analyses cache refreshes this badge automatically.
  const { data: pending } = useQuery({
    queryKey: ["analyses", "pending-count"],
    queryFn: () => fetchAnalyses({ status: "pending_review", pageSize: 1 }),
    staleTime: 15_000,
    enabled: authenticated,
  });
  const pendingCount = pending?.total ?? 0;

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
      <nav className="space-y-1 px-2.5" aria-label="Primary">
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors active:scale-[0.99]",
                active
                  ? "bg-zinc-800/70 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
              )}
            >
              {/* active left accent bar */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 h-4.5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400 transition-opacity",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
              <item.icon
                className={cn("size-4 shrink-0", active ? "text-emerald-400" : "text-zinc-500")}
                aria-hidden
              />
              {item.label}
              {item.id === "review" && (
                <span className="ml-auto flex items-center gap-1.5">
                  {pendingCount > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                            "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          )}
                        >
                          {pendingCount > 99 ? "99+" : pendingCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="border border-zinc-800 bg-zinc-900 text-zinc-300"
                      >
                        {pendingCount.toLocaleString()} analys{pendingCount === 1 ? "is" : "es"} awaiting
                        review — the queue needs a human decision (BR-11).
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <span className="rounded-full border border-zinc-700/60 bg-zinc-800/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-400">
                    human
                  </span>
                </span>
              )}
              {item.id !== "review" && item.gKey && (
                <span
                  className={cn(
                    "ml-auto hidden items-center gap-0.5 opacity-0 transition-opacity group-focus-visible:opacity-100 xl:inline-flex",
                    active ? "opacity-60" : "group-hover:opacity-70"
                  )}
                  aria-hidden
                >
                  <kbd className="veritas-kbd h-4! min-w-4! text-[9px]!">g</kbd>
                  <kbd className="veritas-kbd h-4! min-w-4! text-[9px]!">{item.gKey}</kbd>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Recent analyses */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col px-2.5">
        <div className="flex items-center justify-between px-2.5 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Recent analyses
          </p>
          <kbd className="veritas-kbd" aria-hidden>
            ⌘K
          </kbd>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          {recent?.analyses.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                openAnalysis(a.id);
                onNavigate?.();
              }}
              title={a.inputText}
              className="group flex w-full flex-col items-start gap-1 rounded-md border border-transparent px-2.5 py-2 text-left transition-all hover:border-zinc-800 hover:bg-zinc-800/50"
            >
              <span className="line-clamp-2 w-full text-[12px] leading-snug text-zinc-400 transition-colors group-hover:text-zinc-200">
                {a.inputText}
              </span>
              <span className="flex w-full items-center justify-between gap-2">
                <VerdictBadge label={a.overallLabel} size="sm" />
                <span className="text-[10px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
                  Open →
                </span>
              </span>
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
