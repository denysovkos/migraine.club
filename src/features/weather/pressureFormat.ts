/** Short weekday for a YYYY-MM-DD calendar date, independent of the viewer's offset. */
export function weekdayLabel(date: string, locale: string): string {
  // Noon UTC keeps the calendar date stable whatever the viewer's offset.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
}

/** Signed change in hPa with one decimal, e.g. "+3.0" or "-7.0". */
export function formatChange(change: number): string {
  return change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1);
}
