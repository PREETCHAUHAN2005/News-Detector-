"use client";
/**
 * CommandPalette — Cursor-style ⌘K quick switcher.
 * Fuzzy-search navigation targets and recent analyses; full keyboard control
 * (↑/↓ to move, ↵ to open, esc to close). Only active when signed in.
 *
 * The list body is a separate component that mounts fresh on every open,
 * so search/cursor state resets naturally without effects.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenCheck,
  ChartColumn,
  Download,
  FileSearch,
  History,
  Loader2,
  LogOut,
  Printer,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  SquareLibrary,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchAnalyses, type AnalysesListResponse } from "@/lib/api";
import { downloadReport } from "@/lib/report";
import { LABEL_META, type VerdictLabel } from "@/lib/taxonomy";
import { useAppStore, type ViewId } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { AnalysisDTO } from "@/types/api";

const NAV_TARGETS: { id: ViewId; label: string; hint: string; icon: typeof FileSearch }[] = [
  { id: "home", label: "Analyze a claim", hint: "composer + suggestions", icon: Sparkles },
  { id: "review", label: "Review queue", hint: "human triage (BR-11)", icon: BookOpenCheck },
  { id: "analytics", label: "Analytics", hint: "ops + fairness (BR-16/17)", icon: ChartColumn },
  { id: "appeals", label: "Appeals", hint: "resolution workflow (BR-14)", icon: ScrollText },
  { id: "audit", label: "Audit log", hint: "append-only trail (BR-13)", icon: History },
  { id: "sources", label: "Trusted sources", hint: "registry (BR-03)", icon: SquareLibrary },
  { id: "model-card", label: "Model card", hint: "release gates + limits", icon: ShieldCheck },
];

type Command =
  | { kind: "view"; id: ViewId; label: string; hint: string; icon: typeof FileSearch }
  | { kind: "analysis"; id: string; label: string; hint: string; analysis: AnalysisDTO }
  | { kind: "action"; id: string; label: string; hint: string; icon: typeof FileSearch; run: () => void };

/** Case-insensitive substring match across label + hint. */
function matches(command: Command, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return command.label.toLowerCase().includes(q) || command.hint.toLowerCase().includes(q);
}

export function CommandPalette() {
  const { status } = useSession();
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const authenticated = status === "authenticated";

  /* Global ⌘K / Ctrl+K toggle — only while signed in. */
  useEffect(() => {
    if (!authenticated) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authenticated, open, setOpen]);

  return (
    <Dialog open={open && authenticated} onOpenChange={setOpen}>
      <DialogContent
        className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-900/95 p-0 shadow-2xl shadow-black/40 backdrop-blur-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody onRun={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Inner list — mounts fresh on every open so state starts clean. */
function PaletteBody({ onRun }: { onRun: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setView = useAppStore((s) => s.setView);
  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const activeAnalysisId = useAppStore((s) => s.activeAnalysisId);
  const view = useAppStore((s) => s.view);
  const setPrecedentSearchOpen = useAppStore((s) => s.setPrecedentSearchOpen);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // shares the sidebar's cache — no extra request in the common case
  const { data: recent } = useQuery({
    queryKey: ["sidebar-recent"],
    queryFn: () => fetchAnalyses({ pageSize: 8 }),
    staleTime: 15_000,
  });

  // mid-typing live search (≥3 chars): queries the full history, not just the
  // cached 8 recents — results refresh as you type (debounced by useQuery key)
  const trimmed = query.trim();
  const searchMode = trimmed.length >= 3;
  const { data: searchResults, isFetching: searchFetching } = useQuery({
    queryKey: ["palette-search", trimmed],
    queryFn: () => fetchAnalyses({ q: trimmed, pageSize: 8 }),
    enabled: searchMode,
    staleTime: 10_000,
    placeholderData: (prev: AnalysesListResponse | undefined) => prev,
  });

  // dossier export is offered when a dossier is open and cached
  const cachedDossier = queryClient.getQueryData<{ analysis: AnalysisDTO }>([
    "analysis",
    activeAnalysisId,
  ]);

  const commands = useMemo<Command[]>(() => {
    const views: Command[] = NAV_TARGETS.map((t) => ({
      kind: "view",
      id: t.id,
      label: t.label,
      hint: t.hint,
      icon: t.icon,
    }));
    const analyses: Command[] = (searchMode
      ? searchResults?.analyses ?? []
      : recent?.analyses ?? []
    ).map((a) => ({
      kind: "analysis",
      id: a.id,
      label: a.inputText,
      hint: a.overallLabel ?? "Unverified",
      analysis: a,
    }));
    const actions: Command[] = [
      {
        kind: "action",
        id: "find-precedents",
        label: "Find precedents…",
        hint: "search previous human rulings",
        icon: Scale,
        run: () => setPrecedentSearchOpen(true),
      },
    ];
    if (view === "analysis" && activeAnalysisId && cachedDossier?.analysis) {
      const dossier = cachedDossier.analysis;
      actions.push(
        {
          kind: "action",
          id: "export-dossier",
          label: "Export current dossier",
          hint: `download #${dossier.id.slice(0, 8)} as Markdown`,
          icon: Download,
          run: () => {
            try {
              downloadReport(dossier);
              toast({
                title: "Report exported",
                description: `veritas-report-${dossier.id.slice(0, 8)}.md downloaded.`,
              });
            } catch {
              toast({
                variant: "destructive",
                title: "Export failed",
                description: "The report could not be generated in this browser.",
              });
            }
          },
        },
        {
          kind: "action",
          id: "print-dossier",
          label: "Print / save dossier as PDF",
          hint: "archive the evidence-first document",
          icon: Printer,
          // let the palette unmount before the (blocking) print snapshot
          run: () => setTimeout(() => window.print(), 80),
        }
      );
    }
    actions.push({
      kind: "action",
      id: "signout",
      label: "Sign out",
      hint: "end this session",
      icon: LogOut,
      run: () => void signOut({ callbackUrl: "/" }),
    });
    return [...views, ...analyses, ...actions].filter((c) => matches(c, query));
  }, [recent, searchMode, searchResults, query, view, activeAnalysisId, cachedDossier, toast, setPrecedentSearchOpen]);

  /* Cursor clamped at render time — never out of range. */
  const cursorSafe = commands.length ? Math.min(cursor, commands.length - 1) : 0;

  function run(command: Command | undefined): void {
    if (!command) return;
    onRun();
    if (command.kind === "view") {
      setView(command.id);
    } else if (command.kind === "action") {
      command.run();
    } else {
      openAnalysis(command.id);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor(commands.length ? (cursorSafe + 1) % commands.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(commands.length ? (cursorSafe - 1 + commands.length) % commands.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(commands[cursorSafe]);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-zinc-800 px-4">
        <FileSearch className="size-4 shrink-0 text-zinc-500" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search views and analyses…"
          aria-label="Search views and analyses"
          className="h-12 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <kbd className="veritas-kbd shrink-0" aria-hidden>
          esc
        </kbd>
      </div>

      <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox" aria-label="Commands">
        {commands.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-zinc-500">No matches for “{query}”.</p>
        )}
        {commands.map((command, index) => {
          const selected = index === cursorSafe;
          const isAction = command.kind === "action";
          const Icon =
            command.kind === "view" || command.kind === "action"
              ? command.icon
              : FileSearch;
          const dot = command.kind === "analysis"
            ? LABEL_META[command.hint as VerdictLabel]?.dot ?? "bg-zinc-400"
            : null;
          return (
            <button
              key={`${command.kind}-${command.id}`}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setCursor(index)}
              onClick={() => run(command)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                selected ? "bg-zinc-800/70 text-zinc-100" : "text-zinc-400"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded border",
                  selected
                    ? isAction
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-800 bg-zinc-900 text-zinc-500"
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{command.label}</span>
                <span className="block truncate text-[11px] text-zinc-500">{command.hint}</span>
              </span>
              {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />}
              {selected && (
                <kbd className="veritas-kbd shrink-0" aria-hidden>
                  ↵
                </kbd>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[10px] text-zinc-600">
        {searchMode ? (
          <span className="flex items-center gap-1.5 text-emerald-400/80" title="Live search across the full analysis history (≥3 characters)">
            {searchFetching ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Search className="size-3" aria-hidden />}
            searching full history
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <kbd className="veritas-kbd">↑↓</kbd> navigate
          </span>
        )}
        {!searchMode && (
          <span className="flex items-center gap-1">
            <kbd className="veritas-kbd">↵</kbd> open
          </span>
        )}
        <span className="flex items-center gap-1">
          <kbd className="veritas-kbd">esc</kbd> close
        </span>
        <span className="ml-auto font-mono">Veritas</span>
      </div>
    </>
  );
}
