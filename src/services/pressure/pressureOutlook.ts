import { DateTime } from 'luxon';

/** Threshold choices offered in settings, in hPa of day-over-day fall. */
export const PRESSURE_THRESHOLD_OPTIONS_HPA = [3, 5, 8, 10] as const;

/** Used to highlight drops in the outlook when the user has not set a threshold. */
export const DEFAULT_HIGHLIGHT_THRESHOLD_HPA = 5;

export const MIN_THRESHOLD_HPA = 1;
export const MAX_THRESHOLD_HPA = 30;

/** Days shown in the outlook, today included. */
export const OUTLOOK_DAYS = 6;

/** Alerts look this many days past today (tomorrow and the day after). */
export const ALERT_HORIZON_DAYS = 2;

export type PressurePoint = {
  /** Unix seconds, as returned by the forecast provider. */
  dt: number;
  pressureHpa: number;
};

export type PressureOutlookDay = {
  /** Local date (YYYY-MM-DD) in the user's timezone. */
  date: string;
  pressureHpa: number;
  /** Change vs the previous day in hPa (negative = falling); null for the first day. */
  changeHpa: number | null;
  /** True when the fall vs the previous day is at least the threshold. */
  dropAtOrAboveThreshold: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Turn a daily pressure series into a per-local-day outlook.
 *
 * Points are bucketed by local date in `timezone` (first point wins per day),
 * days before `todayLocal` are dropped, and each day carries its change vs
 * the previous day. Pure: no I/O, so the API, the dashboard and the alert job
 * all agree on what counts as a drop.
 */
export function buildPressureOutlook(
  points: readonly PressurePoint[],
  timezone: string,
  thresholdHpa: number,
  todayLocal: string,
  days: number = OUTLOOK_DAYS,
): PressureOutlookDay[] {
  const byDate = new Map<string, number>();
  const sorted = [...points]
    .filter(p => Number.isFinite(p.dt) && Number.isFinite(p.pressureHpa))
    .sort((a, b) => a.dt - b.dt);

  for (const p of sorted) {
    const date = DateTime.fromSeconds(p.dt, { zone: timezone }).toISODate();
    if (date && !byDate.has(date)) {
      byDate.set(date, p.pressureHpa);
    }
  }

  const dates = [...byDate.keys()].sort();
  const outlook: PressureOutlookDay[] = [];
  let previous: number | null = null;

  for (const date of dates) {
    const pressure = byDate.get(date)!;
    const change = previous === null ? null : round1(pressure - previous);
    previous = pressure;

    if (date < todayLocal) {
      continue;
    }

    outlook.push({
      date,
      pressureHpa: round1(pressure),
      // Null only when no earlier point exists to compare against.
      changeHpa: change,
      dropAtOrAboveThreshold: change !== null && -change >= thresholdHpa,
    });

    if (outlook.length >= days) {
      break;
    }
  }

  return outlook;
}

/**
 * First day after today, within `horizonDays`, whose forecast fall meets the threshold.
 */
export function findUpcomingDrop(
  outlook: readonly PressureOutlookDay[],
  todayLocal: string,
  horizonDays: number = ALERT_HORIZON_DAYS,
): PressureOutlookDay | null {
  const today = DateTime.fromISO(todayLocal);
  const lastDate = today.plus({ days: horizonDays }).toISODate()!;

  return outlook.find(day =>
    day.date > todayLocal
    && day.date <= lastDate
    && day.dropAtOrAboveThreshold,
  ) ?? null;
}

export function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_THRESHOLD_HPA
    && value <= MAX_THRESHOLD_HPA;
}
