"use client";
/**
 * PrecedentSearchDialog — "has anything like this been ruled on before?"
 *
 * A reviewer can paste any statement and instantly see the most similar
 * previously human-reviewed claims — BEFORE creating an analysis. This is a
 * pure lookup over the human-decision record: nothing is persisted and no
 * verdict is issued (the analyze composer stays the entry point for that).
 *
 * Opened from: ⌘K palette action, the "g p" hotkey, and a composer link.
 */
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Scale, Search, ShieldQuestion } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PrecedentRow } from "@/components/verdict/precedent-row";
import { searchPrecedents, type SimilarClaimDTO } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";

export function PrecedentSearchDialog() {
  const open = useAppStore((s) => s.precedentSearchOpen);
  const setOpen = useAppStore((s) => s.setPrecedentSearchOpen);
  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const { toast } = useToast();

  const [text, setText] = useState("");
  const [results, setResults] = useState<SimilarClaimDTO[] | null>(null);
  const [checkedCount, setCheckedCount] = useState(0);

  const searchMutation = useMutation({
    mutationFn: (input: string) => searchPrecedents(input),
    onSuccess: (data) => {
      setResults(data.matches);
      setCheckedCount(data.checkedCount);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Precedent search failed",
        description: error.message,
      });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length < 3 || searchMutation.isPending) return;
    searchMutation.mutate(trimmed);
  }

  const trimmed = text.trim();
  const canSearch = trimmed.length >= 3 && !searchMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // keep results while switching open/close so re-opening feels instant
        setOpen(next);
        if (!next) setText("");
      }}
    >
      <DialogContent
        className="top-[10%] max-w-xl translate-y-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-900/95 p-0 shadow-2xl shadow-black/40 backdrop-blur-xl"
        aria-describedby="precedent-search-desc"
      >
        <DialogHeader className="border-b border-zinc-800 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <Scale className="size-4 text-amber-300/90" aria-hidden />
            Find precedents
          </DialogTitle>
          <DialogDescription id="precedent-search-desc" className="mt-0.5 text-xs text-zinc-500">
            Search how similar claims were ruled by humans — a pure lookup, nothing is analyzed or
            stored.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="border-b border-zinc-800/80 px-4 py-3">
          <label htmlFor="precedent-search-input" className="sr-only">
            Statement to find precedents for
          </label>
          <Textarea
            id="precedent-search-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (canSearch) searchMutation.mutate(trimmed);
              }
            }}
            placeholder="Paste a statement to check against previous rulings…"
            className="min-h-[76px] resize-y border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
            aria-describedby="precedent-search-hint"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <p
              id="precedent-search-hint"
              className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-500"
            >
              Matched by the same similarity channel as verdict reuse (BR-08), at an advisory
              threshold.
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={!canSearch}
              className="h-8 shrink-0 gap-1.5 text-xs"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="size-3.5" aria-hidden />
                  Search precedents
                  <kbd className="veritas-kbd ml-0.5 hidden sm:inline-flex" aria-hidden>
                    ⌘↩
                  </kbd>
                </>
              )}
            </Button>
          </div>
        </form>

        <div className="max-h-[46vh] overflow-y-auto">
          {searchMutation.isPending ? (
            <div className="space-y-2 p-3" aria-live="polite">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : results === null ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/10">
                <ShieldQuestion className="size-5 text-amber-300" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-300">Check before you analyze</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                  Reviewing how near-identical claims were ruled keeps verdicts consistent across
                  the team — precedents are advisory and never auto-applied.
                </p>
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60">
                <Search className="size-5 text-zinc-400" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-300">No precedent above the floor</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                  None of the {checkedCount.toLocaleString()} human-verified claims is similar
                  enough — run the analysis and let the evidence decide.
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="border-b border-zinc-800/60 bg-zinc-950/40 px-4 py-2 text-[11px] text-zinc-500">
                <span className="font-mono tabular-nums text-zinc-400">
                  {results.length}
                </span>{" "}
                similar {results.length === 1 ? "claim" : "claims"} · ranked from{" "}
                {checkedCount.toLocaleString()} human-ruled records
              </p>
              <ul className="divide-y divide-zinc-800/70">
                {results.map((match) => (
                  <li key={match.claimId}>
                    <PrecedentRow
                      match={match}
                      onOpen={(analysisId) => {
                        setOpen(false);
                        openAnalysis(analysisId);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <p className="border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[10px] text-zinc-600">
          Advisory only — precedents inform consistency but never change a verdict. Verdict reuse
          requires the stricter BR-08 near-duplicate gate.
        </p>
      </DialogContent>
    </Dialog>
  );
}
