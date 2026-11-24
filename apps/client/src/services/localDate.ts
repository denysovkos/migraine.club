import { DateTime } from 'luxon';

// Editable window for diary entries (server-enforced): last 30 days including today.
export const EDIT_WINDOW_DAYS = 30;

export type LocalDateString = `${number}-${number}-${number}`; // YYYY-MM-DD

/**
 * Convert an instant to a local calendar date string (YYYY-MM-DD) in the given timezone.
 */
export function toLocalDateString(date: Date, timezone: string): LocalDateString {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  if (!local.isValid) {
    // Fallback to UTC/JS default if timezone is invalid (conservative).
    return DateTime.fromJSDate(date).toISODate()! as LocalDateString;
  }
  return local.toISODate()! as LocalDateString;
}

/**
 * Convert an instant to a JS Date representing the *date-only* value at UTC midnight.
 * Use this when writing to/reading from Postgres DATE columns via Drizzle.
 */
export function toLocalDate(date: Date, timezone: string): Date {
  const ymd = toLocalDateString(date, timezone);
  return ymdToDbDate(ymd);
}

export function ymdToDbDate(ymd: LocalDateString): Date {
  // Postgres DATE has no timezone; represent as UTC midnight for stable serialization.
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function dbDateToYmd(date: Date): LocalDateString {
  return DateTime.fromJSDate(date, { zone: 'UTC' }).toISODate()! as LocalDateString;
}

/**
 * Server-enforced editing window: last EDIT_WINDOW_DAYS days (including today) in the user's timezone.
 */
export function isEditableLocalDate(
  localDate: LocalDateString,
  nowUtc: Date,
  timezone: string,
): boolean {
  const today = DateTime.fromJSDate(nowUtc, { zone: timezone }).startOf('day');
  if (!today.isValid) {
    return false;
  }
  const target = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  if (!target.isValid) {
    return false;
  }

  const earliest = today.minus({ days: EDIT_WINDOW_DAYS - 1 });
  return target >= earliest && target <= today;
}
