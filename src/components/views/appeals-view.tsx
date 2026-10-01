"use client";
/**
 * Appeals (BR-14) — any labelled party can request review.
 * Resolution is restricted to senior reviewers / admins; every change is audit-logged.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  ExternalLink,
  Inbox,
  Loader2,
  Lock,
  Quote,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { VerdictBadge } from "@/components/verdict/verdict-badge";
import { fetchAppeals, resolveAppeal } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { ROLE_DISPLAY, SENIOR_ROLES } from "@/lib/taxonomy";
import { toast } from "@/hooks/use-toast";
import type { AppealDTO } from "@/types/api";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_review", label: "In review" },
  { key: "resolved_upheld", label: "Upheld" },
  { key: "resolved_overturned", label: "Overturned" },
] as const;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  in_review: { label: "In review", cls: "border-teal-500/40 bg-teal-500/10 text-teal-300" },
  resolved_upheld: { label: "Upheld", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  resolved_overturned: { label: "Overturned", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
};

function AppealStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: "border-zinc-600 bg-zinc-800/60 text-zinc-400" };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", meta.cls)}>
      {meta.label}
    </span>
  );
}

/** Resolution duration in hours between filing and resolution. */
function resolutionHours(appeal: AppealDTO): number | null {
  if (!appeal.resolvedAt) return null;
  return (new Date(appeal.resolvedAt).getTime() - new Date(appeal.createdAt).getTime()) / 3_600_000;
}

/* ───────────────────────────── view ───────────────────────────── */

export function AppealsView() {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");
  const [confirming, setConfirming] = useState<{ id: string; status: "resolved_upheld" | "resolved_overturned" } | null>(null);
  const [notes, setNotes] = useState("");

  const openAnalysis = useAppStore((s) => s.openAnalysis);
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = ((session?.user as { role?: string } | undefined)?.role) ?? "viewer";
  const canResolve = SENIOR_ROLES.includes(role);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["appeals"],
    queryFn: () => fetchAppeals(),
  });

  const resolveMutation = useMutation({
    mutationFn: (vars: { id: string; status: string; notes?: string }) =>
      resolveAppeal(vars.id, vars.status, vars.notes),
    onSuccess: (_result, vars) => {
      const label =
        vars.status === "in_review"
          ? "Appeal marked in review"
          : vars.status === "resolved_upheld"
            ? "Appeal upheld — original verdict stands"
            : "Appeal overturned — analysis re-opened for review";
      toast({
        title: label,
        description: "The resolution has been recorded in the audit trail (BR-13).",
      });
      setConfirming(null);
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["appeals"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
      void queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not resolve appeal",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const appeals = data?.appeals ?? [];
  const filtered = statusFilter === "all" ? appeals : appeals.filter((a) => a.status === statusFilter);
  const countFor = (key: string) => (key === "all" ? appeals.length : appeals.filter((a) => a.status === key).length);

  const startConfirm = (id: string, status: "resolved_upheld" | "resolved_overturned") => {
    setConfirming({ id, status });
    setNotes("");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">Appeals</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Any labelled party can request review. Resolution time is tracked (BR-14).
        </p>
      </header>

      {/* status filter chips */}
      <div role="group" aria-label="Filter appeals by status" className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              )}
            >
              {f.label}
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">{countFor(f.key)}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading appeals">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-300" aria-hidden />
            <p className="text-sm text-zinc-300">Appeals could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="mr-2 size-3.5" aria-hidden />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : appeals.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Inbox className="size-8 text-zinc-600" aria-hidden />
            <p className="text-sm font-medium text-zinc-300">No appeals filed yet</p>
            <p className="max-w-md text-xs leading-relaxed text-zinc-500">
              When a labelled party disputes a verdict, their appeal appears here for senior review (BR-14).
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
            <Inbox className="size-8 text-zinc-600" aria-hidden />
            <p className="text-sm text-zinc-400">No appeals with this status.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4" aria-label="Appeals list">
          {filtered.map((appeal) => {
            const analysis = appeal.verdict?.claim?.analysis ?? null;
            const isActive = appeal.status === "open" || appeal.status === "in_review";
            const isConfirmTarget = confirming?.id === appeal.id;
            const hours = resolutionHours(appeal);
            return (
              <li key={appeal.id}>
                <Card className="border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-700">
                  <CardHeader className="space-y-3 p-4 pb-0 sm:p-6 sm:pb-0">
                    {/* header row */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <AppealStatusBadge status={appeal.status} />
                      {analysis ? (
                        <VerdictBadge label={analysis.overallLabel} size="sm" />
                      ) : null}
                      <span className="text-sm font-medium text-zinc-200">{appeal.appellantName}</span>
                      <span className="text-xs text-zinc-500">
                        filed {formatDistanceToNow(new Date(appeal.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* disputed claim */}
                    {analysis ? (
                      <div className="space-y-1.5">
                        <p className="line-clamp-2 text-sm leading-relaxed text-zinc-300" title={analysis.inputText}>
                          {analysis.inputText}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-zinc-800 px-2.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                          onClick={() => openAnalysis(analysis.id)}
                        >
                          <ExternalLink className="mr-1.5 size-3" aria-hidden />
                          Open dossier
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs italic text-zinc-600">The disputed verdict is no longer available.</p>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-3 p-4 pt-3 sm:p-6 sm:pt-3">
                    {/* reason */}
                    <div className="flex gap-2.5">
                      <Quote className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden />
                      <p className="text-sm italic leading-relaxed text-zinc-400">{appeal.reason}</p>
                    </div>

                    {/* resolution section */}
                    {appeal.status.startsWith("resolved") ? (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <ShieldCheck className="size-3.5" aria-hidden />
                            Resolved
                          </span>
                          {appeal.resolver ? (
                            <span className="text-xs text-zinc-400">
                              by {appeal.resolver.name}
                              <span className="ml-1 text-zinc-600">
                                ({ROLE_DISPLAY[appeal.resolver.role] ?? appeal.resolver.role})
                              </span>
                            </span>
                          ) : null}
                          {appeal.resolvedAt ? (
                            <span className="text-xs text-zinc-500">
                              {format(new Date(appeal.resolvedAt), "MMM d, yyyy HH:mm")}
                            </span>
                          ) : null}
                          {hours !== null ? (
                            <span className="font-mono text-xs tabular-nums text-zinc-400" title="Time from filing to resolution (BR-14 SLA)">
                              {hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`} to resolve
                            </span>
                          ) : null}
                        </div>
                        {appeal.resolutionNotes ? (
                          <p className="mt-2 text-xs leading-relaxed text-zinc-400">{appeal.resolutionNotes}</p>
                        ) : null}
                      </div>
                    ) : canResolve ? (
                      isConfirmTarget ? (
                        /* inline confirm panel */
                        <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-3">
                          <p className="text-xs font-medium text-zinc-200">
                            {confirming.status === "resolved_upheld"
                              ? "Uphold the original verdict?"
                              : "Overturn and re-open the analysis?"}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                            {confirming.status === "resolved_upheld"
                              ? "The original verdict stands and the appeal is closed as upheld."
                              : "The analysis is re-opened for re-review and the appellant's challenge is recorded (BR-14)."}
                          </p>
                          <div className="mt-2.5">
                            <label htmlFor={`notes-${appeal.id}`} className="sr-only">
                              Resolution notes
                            </label>
                            <Textarea
                              id={`notes-${appeal.id}`}
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Resolution notes (recorded in the audit trail)…"
                              className="min-h-16 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40"
                            />
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className={
                                confirming.status === "resolved_upheld"
                                  ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                                  : "border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                              }
                              disabled={resolveMutation.isPending}
                              onClick={() =>
                                resolveMutation.mutate({
                                  id: appeal.id,
                                  status: confirming.status,
                                  notes: notes.trim() || undefined,
                                })
                              }
                            >
                              {resolveMutation.isPending ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                              ) : confirming.status === "resolved_upheld" ? (
                                <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
                              ) : (
                                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                              )}
                              {confirming.status === "resolved_upheld" ? "Confirm uphold" : "Confirm overturn"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-zinc-400 hover:text-zinc-200"
                              disabled={resolveMutation.isPending}
                              onClick={() => setConfirming(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
                          {appeal.status === "open" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-zinc-800 text-zinc-300 hover:border-teal-500/50 hover:text-teal-300"
                              disabled={resolveMutation.isPending}
                              onClick={() => resolveMutation.mutate({ id: appeal.id, status: "in_review" })}
                            >
                              {resolveMutation.isPending ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                              ) : null}
                              Mark in review
                            </Button>
                          ) : null}
                          {isActive ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                                disabled={resolveMutation.isPending}
                                onClick={() => startConfirm(appeal.id, "resolved_upheld")}
                              >
                                <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
                                Uphold original
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                                disabled={resolveMutation.isPending}
                                onClick={() => startConfirm(appeal.id, "resolved_overturned")}
                              >
                                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                                Overturn — re-open
                              </Button>
                            </>
                          ) : null}
                        </div>
                      )
                    ) : isActive ? (
                      <p className="flex items-center gap-1.5 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
                        <Lock className="size-3" aria-hidden />
                        Resolution requires a senior reviewer.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
