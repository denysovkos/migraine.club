export function sanitizeReportText(value: string | null | undefined, maxLength = 120): string {
  if (!value) {
    return '';
  }
  return value
    .replace(/[<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeReportTextArray(values: string[] | null | undefined, maxItems = 8): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map(value => sanitizeReportText(value, 80))
    .filter(Boolean)
    .slice(0, maxItems);
}
