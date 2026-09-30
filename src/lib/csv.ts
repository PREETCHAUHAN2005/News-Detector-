/**
 * Shared CSV helpers (BR-13 governance exports).
 * RFC-4180 escaping + a uniform download helper used by the analytics and
 * audit exports.
 */

/** RFC-4180 CSV cell escaping. */
export function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV document from a matrix (first row = header). */
export function buildCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Trigger a browser download for the given CSV content. */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
