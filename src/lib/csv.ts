/**
 * Shared CSV helpers (BR-13 governance exports).
 * RFC-4180 escaping + a uniform download helper used by the analytics and
 * audit exports.
 */

/**
 * RFC-4180 CSV cell escaping + CSV-formula-injection defence (CWE-1236).
 *
 * Cells that BEGIN with =, +, -, @, tab or CR would be interpreted as
 * formulas by Excel / LibreOffice / Google Sheets when a reviewer opens an
 * export. Prefixing a single quote neutralises the payload while keeping the
 * text visible (the standard mitigation recommended by OWASP).
 */
export function csvCell(value: string | number): string {
  const s = String(value);
  // pure numeric values (incl. negatives like "-0.05") stay numeric in
  // spreadsheet apps — everything else formula-capable gets the quote guard
  const isNumeric = /^-?\d+(\.\d+)?$/.test(s.trim());
  const guarded = !isNumeric && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
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
