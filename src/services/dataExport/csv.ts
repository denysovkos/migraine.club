/**
 * Minimal RFC 4180 CSV serialiser for the self-service data export.
 *
 * - Columns are the union of keys across all rows, in first-seen order, so
 *   rows with optional fields still line up.
 * - Dates become ISO 8601 strings; objects and arrays (jsonb columns) become
 *   JSON strings; null and undefined become empty cells.
 * - String cells that a spreadsheet would treat as a formula are prefixed with
 *   a single quote (OWASP CSV injection guidance). Numbers are left untouched
 *   so negative values stay numeric.
 */

const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

export function formatCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let text: string;
  if (value instanceof Date) {
    text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else if (typeof value === 'string') {
    text = value.length > 0 && FORMULA_PREFIXES.has(value[0]!) ? `'${value}` : value;
  } else {
    text = String(value);
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function collectCsvColumns(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function toCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<string> = collectCsvColumns(rows),
): string {
  const lines = [columns.map(formatCsvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => formatCsvCell(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
