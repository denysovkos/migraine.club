import { DateTime } from 'luxon';

/**
 * Returns a set of local YYYY-MM-DD dates overlapped by a time range in a given timezone.
 *
 * Rules:
 * - If end is missing (or invalid), treat as start day only.
 * - If the range ends exactly at midnight, it does NOT count the next day (end-exclusive).
 */
export function getLocalDatesOverlappedByRange(args: {
  start: Date;
  end: Date | null;
  timezone: string;
}): Set<string> {
  const { start, end, timezone } = args;

  const startDt = DateTime.fromJSDate(start).setZone(timezone);
  if (!end) {
    return new Set([startDt.toISODate()!]);
  }

  const endDtRaw = DateTime.fromJSDate(end).setZone(timezone);
  if (!endDtRaw.isValid || endDtRaw <= startDt) {
    return new Set([startDt.toISODate()!]);
  }

  // Treat end as exclusive to avoid counting the next day when end is exactly midnight.
  const endDt = endDtRaw.minus({ millisecond: 1 });
  const startDay = startDt.startOf('day');
  const endDay = endDt.startOf('day');

  const out = new Set<string>();
  let cur = startDay;
  while (cur <= endDay) {
    out.add(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function toLocalISODate(args: { instant: Date; timezone: string }): string {
  return DateTime.fromJSDate(args.instant).setZone(args.timezone).toISODate()!;
}
