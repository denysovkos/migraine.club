import { DateTime } from 'luxon';

function toYmd(value: string | Date): string {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: 'UTC' }).toISODate() ?? '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return DateTime.fromISO(value, { zone: 'UTC' }).toISODate() ?? '';
}

function diffInDays(fromYmd: string, toYmd: string): number {
  const from = DateTime.fromISO(fromYmd, { zone: 'UTC' }).startOf('day');
  const to = DateTime.fromISO(toYmd, { zone: 'UTC' }).startOf('day');
  return Math.round(to.diff(from, 'days').days);
}

export function normalizeDate(value: string | Date): string {
  const ymd = toYmd(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('Invalid date');
  }
  return ymd;
}

export function computeBleedingStartDates(bleedingDays: Set<string>): string[] {
  const sorted = [...bleedingDays]
    .map(normalizeDate)
    .sort((a, b) => a.localeCompare(b));

  const starts: string[] = [];
  for (const date of sorted) {
    const prev = DateTime.fromISO(date, { zone: 'UTC' }).minus({ days: 1 }).toISODate()!;
    if (!bleedingDays.has(prev)) {
      starts.push(date);
    }
  }
  return starts;
}

export function getLastBleedStart(date: string, startDates: string[]): string | null {
  const target = normalizeDate(date);
  const sorted = [...startDates].map(normalizeDate).sort((a, b) => a.localeCompare(b));
  let last: string | null = null;
  for (const start of sorted) {
    if (start <= target) {
      last = start;
      continue;
    }
    break;
  }
  return last;
}

export function getCycleDay(date: string, lastStart: string | null): number | null {
  if (!lastStart) {
    return null;
  }
  const target = normalizeDate(date);
  const start = normalizeDate(lastStart);
  if (target < start) {
    return null;
  }
  return diffInDays(start, target) + 1;
}

export function getRelativeDay(date: string, startDate: string | null): number | null {
  if (!startDate) {
    return null;
  }
  const target = normalizeDate(date);
  const start = normalizeDate(startDate);
  return diffInDays(start, target);
}

export function isInPerimenstrualWindow(
  attackDate: string,
  startDate: string | null,
  windowStart: number,
  windowEnd: number,
): boolean {
  const relativeDay = getRelativeDay(attackDate, startDate);
  if (relativeDay === null) {
    return false;
  }
  return relativeDay >= windowStart && relativeDay <= windowEnd;
}

function getNearestStartDate(date: string, startDates: string[]): string | null {
  const target = normalizeDate(date);
  if (startDates.length === 0) {
    return null;
  }
  let best: string | null = null;
  let bestAbsDelta = Number.POSITIVE_INFINITY;
  for (const start of startDates) {
    const normalizedStart = normalizeDate(start);
    const delta = diffInDays(normalizedStart, target);
    const absDelta = Math.abs(delta);
    if (absDelta < bestAbsDelta) {
      bestAbsDelta = absDelta;
      best = normalizedStart;
    }
  }
  return best;
}

export function buildRelativeAttackHistogram(
  attackDates: string[],
  startDates: string[],
  rangeStart: number,
  rangeEnd: number,
): Map<number, number> {
  const histogram = new Map<number, number>();
  for (let day = rangeStart; day <= rangeEnd; day += 1) {
    histogram.set(day, 0);
  }

  const normalizedStarts = [...startDates].map(normalizeDate).sort((a, b) => a.localeCompare(b));
  for (const attackDate of attackDates) {
    const normalizedAttack = normalizeDate(attackDate);
    const nearestStart = getNearestStartDate(normalizedAttack, normalizedStarts);
    if (!nearestStart) {
      continue;
    }
    const relativeDay = diffInDays(nearestStart, normalizedAttack);
    if (relativeDay < rangeStart || relativeDay > rangeEnd) {
      continue;
    }
    histogram.set(relativeDay, (histogram.get(relativeDay) ?? 0) + 1);
  }

  return histogram;
}
