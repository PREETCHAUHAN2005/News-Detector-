"use client";
/**
 * Model card & release gates (BRD §10/§11) — the transparency surface.
 * Everything the system claims about itself, measured on the frozen golden test set.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Cpu,
  Gauge,
  RotateCcw,
  Scale,
  ShieldCheck,
  TriangleAlert,
  X,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchModelCard } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ──────────────── defensive accessors for Record<string, unknown> ──────────────── */

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function metricNum(rec: Record<string, unknown> | null, key: string): number | null {
  return rec ? asNum(rec[key]) : null;
}

function asNumRecord(v: unknown): Array<[string, number]> {
  const rec = asRecord(v);
  if (!rec) return [];
  return Object.entries(rec)
    .map(([k, val]) => [k, asNum(val)] as const)
    .filter((e): e is [string, number] => e[1] !== null);
}

function asStrRecord(v: unknown): Array<[string, string]> {
  const rec = asRecord(v);
  if (!rec) return [];
  return Object.entries(rec)
    .map(([k, val]) => [k, asStr(val)] as const)
    .filter((e): e is [string, string] => e[1] !== null);
}

/* ───────────────────────── gate definitions ───────────────────────── */

interface GateDef {
  label: string;
  direction: "le" | "ge";
  targetLabel: string;
  fmt: (x: number) => string;
}

const GATE_META: Record<string, GateDef> = {
  fprTrueContentLe2pct: {
    label: "False-positive rate on true content",
    direction: "le",
    targetLabel: "≤ 2%",
    fmt: (x) => `${(x * 100).toFixed(1)}%`,
  },
  contradictedPrecisionGe95pct: {
    label: "Contradicted precision",
    direction: "ge",
    targetLabel: "≥ 95%",
    fmt: (x) => `${(x * 100).toFixed(1)}%`,
  },
  macroF1Ge085: {
    label: "Macro F1 (non-abstained)",
    direction: "ge",
    targetLabel: "≥ 0.85",
    fmt: (x) => x.toFixed(3),
  },
  eceLe005: {
    label: "Expected calibration error",
    direction: "le",
    targetLabel: "≤ 0.05",
    fmt: (x) => x.toFixed(3),
  },
};

const THRESHOLD_LABELS: Record<string, string> = {
  evidenceSimilarityFloor: "Evidence similarity floor (below → abstain)",
  confSupported: "Supported confidence floor",
  confMisleading: "Misleading confidence floor",
  confContradicted: "Contradicted confidence floor",
  nearDuplicateReuse: "Near-duplicate reuse similarity",
};

function fmtPercent(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Small KPI chip for supporting metrics. */
function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1.5 font-mono text-base font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}

/* ───────────────────────────── view ───────────────────────────── */

export function ModelCardView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["model-card"],
    queryFn: fetchModelCard,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Skeleton className="mb-6 h-8 w-72" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-full max-w-md rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-300" aria-hidden />
            <p className="text-sm text-zinc-300">The model card could not be loaded.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="mr-2 size-3.5" aria-hidden />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const card = asRecord(data?.card);
  const evalResult = asRecord(data?.evalResult);

  if (data?.unavailable || !card) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Model card &amp; release gates</h1>
          <p className="mt-1 text-sm text-zinc-500">
            What this system can and cannot do — measured on the frozen golden test set (BRD §9/11).
          </p>
        </header>
        <Alert variant="destructive" className="border-rose-500/30 bg-rose-500/5">
          <AlertTriangle className="size-4 text-rose-400" aria-hidden />
          <AlertTitle className="text-sm font-medium">Model card unavailable — engine offline</AlertTitle>
          <AlertDescription className="text-xs text-rose-200/70">
            {asStr(data?.message) ??
              "NLP engine unavailable — fail-safe active. Analyses are filed as Unverified and routed to human review."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  /* card fields (all parsed defensively) */
  const modelVersion = asStr(card.modelVersion) ?? "—";
  const dataVersion = asStr(card.dataVersion) ?? "—";
  const approach = asStr(card.approach);
  const kbSize = asNum(card.kbSize);
  const kbRatings = asNumRecord(card.kbRatings);
  const startupSeconds = asNum(card.startupSeconds);
  const safetyProperties = asStrArray(card.safetyProperties);
  const knownLimitations = asStrArray(card.knownLimitations);
  const thresholds = asRecord(card.thresholds) ?? {};
  const calibration = asRecord(card.calibration) ?? {};
  const checksums = asStrRecord(card.corpusChecksums);

  /* eval fields */
  const gatesRecord = asRecord(evalResult?.gates) ?? {};
  const gateRows = Object.entries(gatesRecord)
    .map(([key, def]) => {
      const rec = asRecord(def);
      const target = rec ? asNum(rec.target) : null;
      const actual = rec ? asNum(rec.actual) : null;
      return { key, target, actual };
    })
    .filter((g): g is { key: string; target: number; actual: number } => g.target !== null && g.actual !== null);
  const nTest = metricNum(evalResult, "nTest");
  const nJudged = metricNum(evalResult, "nJudged");
  const evaluatedOn = evalResult ? asStr(evalResult.evaluatedOn) : null;

  const abstentionRate = metricNum(evalResult, "abstentionRate");
  const accuracy = metricNum(evalResult, "accuracyNonAbstained");
  const macroF1 = metricNum(evalResult, "macroF1NonAbstained");
  const conPrecision = metricNum(evalResult, "contradictedPrecision");
  const fprTrue = metricNum(evalResult, "falsePositiveRateOnTrueContent");
  const ece = metricNum(evalResult, "eceNonAbstained");

  const supportMetrics: Array<{ label: string; value: string }> = [
    { label: "Abstention rate", value: abstentionRate !== null ? fmtPercent(abstentionRate) : "—" },
    { label: "Accuracy (non-abst.)", value: accuracy !== null ? fmtPercent(accuracy) : "—" },
    { label: "Macro F1 (non-abst.)", value: macroF1 !== null ? macroF1.toFixed(3) : "—" },
    { label: "Contradicted precision", value: conPrecision !== null ? fmtPercent(conPrecision) : "—" },
    { label: "FPR on true content", value: fprTrue !== null ? fmtPercent(fprTrue) : "—" },
    { label: "ECE (non-abst.)", value: ece !== null ? ece.toFixed(3) : "—" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">Model card &amp; release gates</h1>
        <p className="mt-1 text-sm text-zinc-500">
          What this system can and cannot do — measured on the frozen golden test set (BRD §9/11).
        </p>
      </header>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 sm:w-fit">
          <TabsTrigger value="overview" className="px-3 py-1.5 text-xs text-zinc-400 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
            Overview
          </TabsTrigger>
          <TabsTrigger value="metrics" className="px-3 py-1.5 text-xs text-zinc-400 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
            Metrics &amp; gates
          </TabsTrigger>
          <TabsTrigger value="calibration" className="px-3 py-1.5 text-xs text-zinc-400 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
            Calibration &amp; thresholds
          </TabsTrigger>
          <TabsTrigger value="limitations" className="px-3 py-1.5 text-xs text-zinc-400 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
            Limitations
          </TabsTrigger>
        </TabsList>

        {/* ── Overview: identity + safety ── */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Cpu className="size-4 text-zinc-500" aria-hidden />
                Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Model version</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">{modelVersion}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Data version</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">{dataVersion}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">KB size</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">
                    {kbSize !== null ? kbSize.toLocaleString() : "—"}
                    {kbRatings.length ? <span className="text-zinc-600"> statements</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Startup</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">
                    {startupSeconds !== null ? `${startupSeconds.toFixed(1)}s` : "—"}
                  </dd>
                </div>
              </dl>

              {kbRatings.length ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">KB rating distribution</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {kbRatings.map(([rating, count]) => (
                      <p key={rating} className="font-mono text-[11px] text-zinc-400">
                        <span className="text-zinc-500">{rating}</span>
                        <span className="mx-1.5 text-zinc-700">·</span>
                        <span className="text-zinc-200">{count.toLocaleString()}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {approach ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">Approach</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{approach}</p>
                </div>
              ) : null}

              {checksums.length ? <Checksums rows={checksums} /> : null}
            </CardContent>
          </Card>

          {/* safety properties — hero */}
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                <ShieldCheck className="size-4" aria-hidden />
                Safety properties
              </CardTitle>
              <CardDescription className="text-xs text-emerald-200/60">
                Non-negotiable guarantees baked into every verdict this system produces.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <ul className="space-y-2.5">
                {safetyProperties.length ? (
                  safetyProperties.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                      <span className="text-sm leading-relaxed text-zinc-200">{p}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-zinc-500">No safety properties reported.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Metrics & gates ── */}
        <TabsContent value="metrics" className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Gauge className="size-4 text-zinc-500" aria-hidden />
                Release gates — frozen golden test set
              </CardTitle>
              <CardDescription className="text-xs">
                {evaluatedOn ?? "Measured on the frozen test split, never used for training or tuning."}
                {nJudged !== null && nTest !== null ? (
                  <>
                    {" "}
                    Judged <span className="font-mono text-zinc-300">{nJudged.toLocaleString()}</span> of{" "}
                    <span className="font-mono text-zinc-300">{nTest.toLocaleString()}</span> statements (the rest abstained).
                  </>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {supportMetrics.map((m) => (
                  <MetricChip key={m.label} label={m.label} value={m.value} />
                ))}
              </div>

              <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Gate</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Target</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Actual</TableHead>
                      <TableHead className="h-10 text-right text-[11px] uppercase tracking-wide text-zinc-500">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gateRows.length ? (
                      gateRows.map((g) => {
                        const meta = GATE_META[g.key];
                        const target = g.target as number;
                        const actual = g.actual as number;
                        const passed = meta
                          ? meta.direction === "le"
                            ? actual <= target
                            : actual >= target
                          : actual >= target;
                        return (
                          <TableRow key={g.key} className="border-zinc-800/60 hover:bg-zinc-900/60">
                            <TableCell className="py-2.5 text-sm text-zinc-300">
                              {meta?.label ?? g.key}
                            </TableCell>
                            <TableCell className="py-2.5 font-mono text-xs tabular-nums text-zinc-400">
                              {meta?.targetLabel ?? `≥ ${target}`}
                            </TableCell>
                            <TableCell className="py-2.5 font-mono text-sm font-semibold tabular-nums text-zinc-100">
                              {meta ? meta.fmt(actual) : String(actual)}
                            </TableCell>
                            <TableCell className="py-2.5 text-right">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                  passed
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                    : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                                )}
                              >
                                {passed ? (
                                  <Check className="size-3" aria-hidden />
                                ) : (
                                  <X className="size-3" aria-hidden />
                                )}
                                {passed ? "Pass" : "Fail"}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow className="border-zinc-800/60 hover:bg-transparent">
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-zinc-500">
                          No gate results available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-200/80">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
                Gates not yet met are shown as failing — v1 ships in shadow mode with human confirmation on every verdict.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Calibration & thresholds ── */}
        <TabsContent value="calibration" className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Scale className="size-4 text-zinc-500" aria-hidden />
                Confidence calibration
              </CardTitle>
              <CardDescription className="text-xs">
                Reported confidences are post-hoc calibrated; the ECE below is measured on the validation split.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              {asStr(calibration.method) ? (
                <p className="text-sm leading-relaxed text-zinc-300">{asStr(calibration.method)}</p>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Validation points</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">
                    {asNum(calibration.validationPoints)?.toLocaleString() ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Validation ECE</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">
                    {asNum(calibration.validationEce) !== null ? (asNum(calibration.validationEce) as number).toFixed(3) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Platt a</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">{asNum(calibration.a) ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Platt b</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-200">{asNum(calibration.b) ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="text-sm font-medium text-zinc-200">Decision thresholds</CardTitle>
              <CardDescription className="text-xs">
                Asymmetric by design: Contradicted requires ≥70% calibrated confidence vs 60% for Supported —
                wrongly calling true content false is the worst failure (BRD §6.5).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Threshold</TableHead>
                      <TableHead className="h-10 text-right text-[11px] uppercase tracking-wide text-zinc-500">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.keys(thresholds).length ? (
                      Object.entries(thresholds).map(([key, value]) => {
                        const num = asNum(value);
                        return (
                          <TableRow key={key} className="border-zinc-800/60 hover:bg-zinc-900/60">
                            <TableCell className="py-2.5 text-sm text-zinc-300">
                              {THRESHOLD_LABELS[key] ?? key}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-zinc-100">
                              {num !== null ? `${Math.round(num * 100)}%` : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow className="border-zinc-800/60 hover:bg-transparent">
                        <TableCell colSpan={2} className="py-6 text-center text-sm text-zinc-500">
                          No thresholds reported.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Limitations ── */}
        <TabsContent value="limitations">
          <Card className="border-zinc-800 bg-zinc-900/40">
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <TriangleAlert className="size-4 text-amber-300" aria-hidden />
                Known limitations
              </CardTitle>
              <CardDescription className="text-xs">
                What this system cannot do — stated up front so nobody has to discover it the hard way.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <ul className="space-y-2.5">
                {knownLimitations.length ? (
                  knownLimitations.map((l) => (
                    <li key={l} className="flex gap-2.5">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                      <span className="text-sm leading-relaxed text-zinc-300">{l}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-zinc-500">No limitations reported.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────── corpus checksums (collapsible) ───────────────── */

function Checksums({ rows }: { rows: Array<[string, string]> }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500 transition-colors hover:text-zinc-300">
        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        Corpus checksums
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {rows.map(([file, hash]) => (
            <p key={file} className="font-mono text-[10px] text-zinc-500">
              <span className="text-zinc-400">{file}</span>
              <span className="mx-1.5 text-zinc-700">·</span>
              {hash}
            </p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
