"use client";
/**
 * Audit log (BR-13) — append-only trail of every state change,
 * filterable by action / entity type, paginated.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RotateCcw,
  ScrollText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAudit } from "@/lib/api";
import { ROLE_DISPLAY } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { AuditLogDTO } from "@/types/api";

const ENTITY_TYPES = ["analysis", "verdict", "appeal", "trusted_source"] as const;

/** Chip colour by action prefix. */
function actionChipCls(action: string): string {
  if (action === "engine_degraded") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (action.startsWith("analysis_")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (action.startsWith("review_")) return "border-teal-500/40 bg-teal-500/10 text-teal-300";
  if (action.startsWith("appeal_")) return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (action.startsWith("source_")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (action.startsWith("feedback_")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-zinc-600/60 bg-zinc-800/60 text-zinc-400"; // dedup_* and unknown
}

/** Defensive JSON.detail parse → compact key:value rows. */
function parseDetail(raw: string | null | undefined): Array<[string, string]> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
        k,
        v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v),
      ]);
    }
    return [["value", String(parsed)]];
  } catch {
    return [["detail", raw]];
  }
}

function DetailCell({ raw }: { raw: string | null | undefined }) {
  if (!raw) return <span className="text-xs text-zinc-700">—</span>;
  const rows = parseDetail(raw);
  return (
    <p
      className="line-clamp-2 max-w-[340px] text-[11px] leading-relaxed text-zinc-500"
      title={rows.map(([k, v]) => `${k}: ${v}`).join("\n")}
    >
      {rows.map(([k, v], i) => (
        <span key={k}>
          {i > 0 ? " · " : ""}
          <span className="text-zinc-400">{k}:</span> {v}
        </span>
      ))}
    </p>
  );
}

/** RFC-4180 CSV cell escaping. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Build the CSV document for a set of audit rows. */
function buildAuditCsv(rows: AuditLogDTO[]): string {
  const header = ["id", "timestamp", "actor", "role", "action", "entity_type", "entity_id", "detail"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        new Date(r.createdAt).toISOString(),
        r.actor?.name ?? "system",
        r.actor?.role ?? "",
        r.action,
        r.entityType,
        r.entityId,
        r.detail ?? "",
      ]
        .map((c) => csvCell(String(c)))
        .join(",")
    );
  }
  return lines.join("\n");
}

/* ───────────────────────────── view ───────────────────────────── */

export function AuditView() {
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["audit", action, entityType, page],
    queryFn: () =>
      fetchAudit({
        action: action === "all" ? undefined : action,
        entityType: entityType === "all" ? undefined : entityType,
        page,
      }),
    placeholderData: (prev) => prev,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // action options: whatever exists in the trail (+ current selection)
  const actionOptions = [...(data?.availableActions ?? [])];
  if (action !== "all" && !actionOptions.includes(action)) actionOptions.push(action);
  actionOptions.sort((a, b) => a.localeCompare(b));

  /** Export every row matching the current filters (capped at 1,000 rows). */
  async function exportCsv(): Promise<void> {
    setExporting(true);
    try {
      const rows: AuditLogDTO[] = [];
      const filterAction = action === "all" ? undefined : action;
      const filterEntity = entityType === "all" ? undefined : entityType;
      const first = await fetchAudit({
        action: filterAction,
        entityType: filterEntity,
        page: 1,
        pageSize: 100,
      });
      rows.push(...first.logs);
      const pages = Math.min(10, Math.ceil(first.total / first.pageSize));
      for (let p = 2; p <= pages; p++) {
        const next = await fetchAudit({
          action: filterAction,
          entityType: filterEntity,
          page: p,
          pageSize: 100,
        });
        rows.push(...next.logs);
      }
      const blob = new Blob([buildAuditCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `veritas-audit-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Audit log exported",
        description: `${rows.length.toLocaleString()} events as CSV${rows.length >= 1000 ? " (capped at 1,000)" : ""}.`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "The audit trail could not be exported right now.",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">Audit log</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Append-only trail of every state change (BR-13).
        </p>
      </header>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3" role="group" aria-label="Audit log filters">
        <div>
          <label htmlFor="audit-action" className="sr-only">
            Filter by action
          </label>
          <Select
            value={action}
            onValueChange={(v) => {
              setAction(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="audit-action" className="h-9 w-52 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-950">
              <SelectItem value="all">All actions</SelectItem>
              {actionOptions.map((a) => (
                <SelectItem key={a} value={a} className="font-mono text-xs">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="audit-entity" className="sr-only">
            Filter by entity type
          </label>
          <Select
            value={entityType}
            onValueChange={(v) => {
              setEntityType(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="audit-entity" className="h-9 w-48 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300">
              <SelectValue placeholder="Entity type" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-950">
              <SelectItem value="all">All entity types</SelectItem>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="ml-auto font-mono text-xs tabular-nums text-zinc-500">
          {total.toLocaleString()} events
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300 hover:border-zinc-700"
          onClick={() => void exportCsv()}
          disabled={exporting || total === 0}
        >
          {exporting ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
              Exporting…
            </>
          ) : (
            <>
              <Download className="mr-1.5 size-3.5" aria-hidden />
              Export CSV
            </>
          )}
        </Button>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading audit log">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <AlertTriangle className="size-8 text-amber-300" aria-hidden />
              <p className="text-sm text-zinc-300">The audit log could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RotateCcw className="mr-2 size-3.5" aria-hidden />
                Retry
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <ScrollText className="size-8 text-zinc-600" aria-hidden />
              <p className="text-sm text-zinc-400">No audit events match these filters.</p>
            </div>
          ) : (
            <>
              <div className="max-h-[70vh] overflow-y-auto [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Time</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Actor</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Action</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Entity</TableHead>
                      <TableHead className="h-10 text-[11px] uppercase tracking-wide text-zinc-500">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow
                        key={log.id}
                        className="border-zinc-800/60 transition-colors hover:bg-zinc-900/60"
                      >
                        <TableCell className="whitespace-nowrap py-2.5">
                          <time
                            className="font-mono text-xs tabular-nums text-zinc-300"
                            title={new Date(log.createdAt).toISOString()}
                            dateTime={new Date(log.createdAt).toISOString()}
                          >
                            {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                          </time>
                        </TableCell>
                        <TableCell className="py-2.5">
                          {log.actor ? (
                            <div className="flex flex-col">
                              <span className="text-xs text-zinc-300">{log.actor.name}</span>
                              <span className="text-[10px] uppercase tracking-wide text-zinc-600">
                                {ROLE_DISPLAY[log.actor.role] ?? log.actor.role}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs italic text-zinc-600">system</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                              actionChipCls(log.action)
                            )}
                          >
                            {log.action}
                          </span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-xs text-zinc-400">{log.entityType}</span>{" "}
                          <span className="font-mono text-[10px] text-zinc-500" title={log.entityId}>
                            #{log.entityId.slice(0, 6)}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[340px] py-2.5">
                          <DetailCell raw={log.detail} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* pagination */}
              <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
                <p className="font-mono text-xs tabular-nums text-zinc-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                    disabled={page <= 1 || isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-3.5" aria-hidden />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                    disabled={page >= totalPages || isFetching}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
