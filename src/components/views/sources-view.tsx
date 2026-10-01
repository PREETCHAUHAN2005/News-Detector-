"use client";
/**
 * Trusted-source registry (BR-03/07) — evidence is cited from allow-listed
 * sources only; registry changes are admin-owned and audit-logged.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  Database,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fetchSources, upsertSource } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { TrustedSourceDTO } from "@/types/api";
import { cn } from "@/lib/utils";

const CATEGORY_META: Record<string, { label: string; cls: string }> = {
  fact_check: { label: "Fact-check", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  wire_service: { label: "Wire service", cls: "border-teal-500/40 bg-teal-500/10 text-teal-300" },
  official_records: { label: "Official records", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  news: { label: "News", cls: "border-zinc-600/60 bg-zinc-800/60 text-zinc-400" },
};

const CATEGORY_KEYS = ["fact_check", "wire_service", "official_records", "news"] as const;

function SourceCard({ source }: { source: TrustedSourceDTO }) {
  const cat = CATEGORY_META[source.category] ?? { label: source.category, cls: "border-zinc-600/60 bg-zinc-800/60 text-zinc-400" };
  const percent = Math.round(Math.max(0, Math.min(1, source.reliabilityScore)) * 100);
  return (
    <Card className="border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-600">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{source.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-zinc-400" title={source.domain}>
              {source.domain}
            </p>
          </div>
          {source.approved ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              approved
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="size-2 rounded-full bg-zinc-600" aria-hidden />
              unlisted
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", cat.cls)}>
            {cat.label}
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums text-zinc-300">{percent}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Progress value={percent} className="h-1.5 bg-zinc-800" aria-label={`Reliability ${percent} percent`} />
        </div>

        {source.notes ? (
          <p className="text-[11px] leading-relaxed text-zinc-500">{source.notes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── view ───────────────────────────── */

export function SourcesView() {
  const { data: session } = useSession();
  const role = ((session?.user as { role?: string } | undefined)?.role) ?? "viewer";
  const isAdmin = role === "admin";

  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [category, setCategory] = useState<string>("fact_check");
  const [score, setScore] = useState("0.90");
  const [notes, setNotes] = useState("");

  const upsertMutation = useMutation({
    mutationFn: upsertSource,
    onSuccess: (result) => {
      toast({
        title: "Source saved to the registry",
        description: `${result.source.name} (${result.source.domain}) — change recorded in the audit trail (BR-13).`,
      });
      setOpen(false);
      setName("");
      setDomain("");
      setCategory("fact_check");
      setScore("0.90");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save source",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const submit = () => {
    const parsedScore = Number.parseFloat(score);
    if (name.trim().length < 2) {
      toast({ title: "Name is too short", description: "Use at least 2 characters.", variant: "destructive" });
      return;
    }
    if (domain.trim().length < 3 || !domain.includes(".")) {
      toast({ title: "Invalid domain", description: "Enter a domain such as politifact.com.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 1) {
      toast({ title: "Invalid reliability score", description: "Reliability must be between 0 and 1 (e.g. 0.95).", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      category,
      reliabilityScore: parsedScore,
      notes: notes.trim() || undefined,
    });
  };

  const sources = data?.sources ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-zinc-100">Trusted-source registry</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Evidence is cited from allow-listed sources only. Changes are audit-logged and owned by editorial leadership.
        </p>
      </header>

      <Alert className="mb-6 border-amber-500/30 bg-amber-500/5 text-amber-200">
        <ShieldCheck className="size-4 text-amber-300" aria-hidden />
        <AlertTitle className="text-sm font-medium text-amber-200">Citation policy (BR-03/07)</AlertTitle>
        <AlertDescription className="text-xs text-amber-200/70">
          Only approved sources are eligible for citation. Verdicts cannot cite unlisted domains.
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading sources">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-300" aria-hidden />
            <p className="text-sm text-zinc-300">The registry could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="mr-2 size-3.5" aria-hidden />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : sources.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
            <Database className="size-8 text-zinc-600" aria-hidden />
            <p className="text-sm text-zinc-400">The registry is empty.</p>
            <p className="text-xs text-zinc-600">
              An administrator can add trusted sources below.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Trusted sources">
          {sources.map((s) => (
            <li key={s.id}>
              <SourceCard source={s} />
            </li>
          ))}
        </ul>
      )}

      {/* admin management section */}
      <Card className="mt-6 border-zinc-800 bg-zinc-900/40">
        <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            {isAdmin ? <Plus className="size-4 text-emerald-400" aria-hidden /> : <Lock className="size-4 text-zinc-500" aria-hidden />}
            Registry management
          </CardTitle>
          <CardDescription className="text-xs">
            {isAdmin
              ? "Add a new trusted source or update an existing one by name. Every change is audit-logged."
              : "Registry changes require administrator role."}
          </CardDescription>
        </CardHeader>
        {isAdmin ? (
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <Button
              size="sm"
              className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              onClick={() => setOpen(true)}
            >
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Add source
            </Button>
          </CardContent>
        ) : (
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Lock className="size-3" aria-hidden />
              You are signed in as {role.replace("_", " ")} — ask an administrator to make registry changes.
            </p>
          </CardContent>
        )}
      </Card>

      {/* add / update source dialog (admin only) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Add or update a trusted source</DialogTitle>
            <DialogDescription className="text-xs">
              Existing sources are matched by name and updated in place (BR-07).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="src-name" className="text-xs text-zinc-400">
                Name
              </Label>
              <Input
                id="src-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="PolitiFact"
                className="border-zinc-800 bg-zinc-900/60 text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="src-domain" className="text-xs text-zinc-400">
                Domain
              </Label>
              <Input
                id="src-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="politifact.com"
                className="border-zinc-800 bg-zinc-900/60 font-mono text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="src-category" className="text-xs text-zinc-400">
                  Category
                </Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="src-category" className="border-zinc-800 bg-zinc-900/60 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-950">
                    {CATEGORY_KEYS.map((k) => (
                      <SelectItem key={k} value={k} className="text-sm">
                        {CATEGORY_META[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="src-score" className="text-xs text-zinc-400">
                  Reliability (0–1)
                </Label>
                <Input
                  id="src-score"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="border-zinc-800 bg-zinc-900/60 font-mono text-sm"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="src-notes" className="text-xs text-zinc-400">
                Notes <span className="text-zinc-600">(optional)</span>
              </Label>
              <Textarea
                id="src-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why this source is trusted, scope, caveats…"
                className="min-h-16 border-zinc-800 bg-zinc-900/60 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-800 text-zinc-400 hover:text-zinc-200"
              disabled={upsertMutation.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              disabled={upsertMutation.isPending}
              onClick={submit}
            >
              {upsertMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save source"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
