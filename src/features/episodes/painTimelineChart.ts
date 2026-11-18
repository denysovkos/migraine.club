import { midnightsBetween } from '@/services/episodes/painTimeline';

export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 140;
export const CHART_PAD = { top: 12, right: 12, bottom: 22, left: 26 } as const;

export type ChartPoint = { id: string; x: number; y: number; intensity: number; recordedAt: Date };
export type ChartModel = {
  points: ChartPoint[];
  /** x position and instant of each local midnight crossed by the attack. */
  midnights: Array<{ x: number; at: Date }>;
  /** y position of each level 1–5 for gridlines. */
  levels: Array<{ level: number; y: number }>;
  start: Date;
  end: Date;
  spansMultipleDays: boolean;
};

/**
 * Lay out an attack's pain readings on a time axis running from onset to the
 * end of the attack (or now, while it is ongoing). Readings recorded outside
 * that range are clamped so a slightly skewed device clock never draws off
 * the chart.
 */
export function buildChartModel(args: {
  readings: ReadonlyArray<{ id: string; recordedAt: string | Date; intensity: number }>;
  start: Date;
  end: Date | null;
  now: Date;
  timezone: string;
}): ChartModel {
  const sorted = args.readings
    .map(r => ({ ...r, recordedAt: new Date(r.recordedAt) }))
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const lastReading = sorted.at(-1)?.recordedAt;
  let endMs = (args.end ?? args.now).getTime();
  if (lastReading && lastReading.getTime() > endMs) {
    endMs = lastReading.getTime();
  }
  const startMs = Math.min(args.start.getTime(), sorted[0]?.recordedAt.getTime() ?? Infinity);
  // Avoid a zero-width axis for an attack logged a moment ago.
  const span = Math.max(endMs - startMs, 60_000);

  const innerW = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const xOf = (ms: number) => CHART_PAD.left + ((ms - startMs) / span) * innerW;
  const yOf = (level: number) => CHART_PAD.top + ((5 - level) / 4) * innerH;

  const start = new Date(startMs);
  const end = new Date(startMs + span);
  const midnights = midnightsBetween(start, end, args.timezone).map(at => ({ x: xOf(at.getTime()), at }));

  return {
    points: sorted.map(r => ({
      id: r.id,
      x: xOf(r.recordedAt.getTime()),
      y: yOf(r.intensity),
      intensity: r.intensity,
      recordedAt: r.recordedAt,
    })),
    midnights,
    levels: [1, 2, 3, 4, 5].map(level => ({ level, y: yOf(level) })),
    start,
    end,
    spansMultipleDays: midnights.length > 0,
  };
}

/** `YYYY-MM-DDTHH:mm` in the browser's local time, for <input type="datetime-local">. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Default time for a new reading: now, or the end of an attack that is over. */
export function defaultReadingTime(end: Date | null, now: Date): Date {
  return end && end.getTime() < now.getTime() ? end : now;
}
