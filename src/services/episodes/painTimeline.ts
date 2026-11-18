import { DateTime } from 'luxon';

/** Pain readings use the same 1–5 scale as the attack's own intensity. */
export const PAIN_READING_MIN = 1;
export const PAIN_READING_MAX = 5;

/** Device clocks drift; a reading a few minutes "in the future" is still accepted. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type PainReadingPoint = {
  id: string;
  recordedAt: Date;
  intensity: number;
};

export type AttackWindow = {
  /** True onset if the user reported one, else the logged start. */
  start: Date;
  /** End of the attack, or null while it is ongoing. */
  end: Date | null;
};

export type ReadingTimeCheck
  = | { ok: true }
    | { ok: false; reason: 'before_start' | 'after_end' | 'in_future' };

export function attackWindow(episode: {
  startTime: Date;
  onsetAt: Date | null;
  endTime: Date | null;
  isOngoing: boolean;
}): AttackWindow {
  const start = episode.onsetAt && episode.onsetAt < episode.startTime ? episode.onsetAt : episode.startTime;
  return { start, end: episode.isOngoing ? null : episode.endTime };
}

/**
 * A reading must fall inside the attack: not before it began, not after it
 * ended, and (for an ongoing attack) not in the future.
 */
export function checkReadingTime(recordedAt: Date, window: AttackWindow, now: Date): ReadingTimeCheck {
  if (recordedAt.getTime() < window.start.getTime()) {
    return { ok: false, reason: 'before_start' };
  }
  if (window.end && recordedAt.getTime() > window.end.getTime()) {
    return { ok: false, reason: 'after_end' };
  }
  if (recordedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return { ok: false, reason: 'in_future' };
  }
  return { ok: true };
}

export function sortReadings<T extends { recordedAt: Date }>(readings: readonly T[]): T[] {
  return [...readings].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

export function peakIntensity(readings: readonly { intensity: number }[]): number | null {
  if (readings.length === 0) {
    return null;
  }
  return Math.max(...readings.map(r => r.intensity));
}

/**
 * Local midnights strictly inside (from, to] in the user's timezone. Used to
 * mark day boundaries on the chart of a multi-day or past-midnight attack.
 */
export function midnightsBetween(from: Date, to: Date, timezone: string): Date[] {
  if (to.getTime() <= from.getTime()) {
    return [];
  }
  let cursor = DateTime.fromJSDate(from, { zone: timezone });
  if (!cursor.isValid) {
    cursor = DateTime.fromJSDate(from, { zone: 'UTC' });
  }
  const out: Date[] = [];
  let next = cursor.startOf('day').plus({ days: 1 });
  // Hard cap so a corrupt end time cannot produce an unbounded list.
  while (next.toMillis() <= to.getTime() && out.length < 60) {
    out.push(next.toJSDate());
    next = next.plus({ days: 1 });
  }
  return out;
}
