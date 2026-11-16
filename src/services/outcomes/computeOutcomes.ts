import { DateTime } from 'luxon';

import { toLocalISODate } from './localDateOverlap';

export type OutcomesDailyPoint = {
  date: string; // YYYY-MM-DD (local)
  // Day classification (missing = null). Missing is NOT assumed headache-free.
  dayType: 'headache_free' | 'headache_day' | 'migraine_day' | null;
  // Medication day evidence for metrics (evidence-based from medication_intakes).
  tookMedication: boolean;
  medications: string[]; // names taken that day (best-effort)
};

export type OutcomesTotals = {
  // Conservative range because missing diary days are unknown.
  mmdMin: number;
  mmdMax: number;
  mhdMin: number;
  mhdMax: number;
  acuteMedicationDays: number;
  coverage: { totalDays: number; recordedDays: number; missingDays: number };
};

export type ComputeOutcomesResult = {
  windowDays: number;
  timezone: string;
  totals: OutcomesTotals;
  daily: OutcomesDailyPoint[];
  baseline?: { from: string; to: string; mmd: number; mhd: number };
  responder50?: {
    status: 'YES' | 'NO' | 'NA';
    reason?: 'INSUFFICIENT_COVERAGE';
    baselineMmd?: number;
    currentMmd?: number;
  };
};

export type EpisodeMedicationLike = {
  takenAt: Date;
  name?: string | null;
};

export type DiaryDayEntryLike = {
  localDate: string; // YYYY-MM-DD local
  dayType: 'headache_free' | 'headache_day' | 'migraine_day';
};

function listLocalDatesInclusive(args: {
  from: string; // YYYY-MM-DD local
  to: string; // YYYY-MM-DD local
  timezone: string;
}): string[] {
  const { from, to, timezone } = args;
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone }).startOf('day');
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function computeOutcomesForRange(args: {
  timezone: string;
  windowDays: number;
  from: string; // YYYY-MM-DD local (inclusive)
  to: string; // YYYY-MM-DD local (inclusive)
  diaryDays: DiaryDayEntryLike[];
  medicationIntakes: EpisodeMedicationLike[];
}): Omit<ComputeOutcomesResult, 'baseline' | 'responder50'> {
  const {
    timezone,
    windowDays,
    from,
    to,
    diaryDays,
    medicationIntakes,
  } = args;

  const medicationDays = new Set<string>();
  const medicationNamesByDay = new Map<string, Set<string>>();
  for (const m of medicationIntakes) {
    const day = toLocalISODate({ instant: m.takenAt, timezone });
    medicationDays.add(day);
    if (m.name && m.name.trim()) {
      const set = medicationNamesByDay.get(day) ?? new Set<string>();
      set.add(m.name.trim());
      medicationNamesByDay.set(day, set);
    }
  }

  const diaryByDate = new Map<string, DiaryDayEntryLike>();
  for (const e of diaryDays) {
    diaryByDate.set(e.localDate, e);
  }

  const days = listLocalDatesInclusive({ from, to, timezone });
  const daily: OutcomesDailyPoint[] = days.map((date) => {
    const diary = diaryByDate.get(date) ?? null;
    const dayType = diary?.dayType ?? null;
    const tookMedication = medicationDays.has(date);

    return {
      date,
      dayType,
      tookMedication,
      medications: [...(medicationNamesByDay.get(date) ?? new Set<string>())].sort(),
    };
  });

  const totalDays = days.length;
  const recordedDays = daily.reduce((n, d) => n + (d.dayType ? 1 : 0), 0);
  const missingDays = totalDays - recordedDays;

  const mhdMin = daily.reduce((n, d) => n + (d.dayType === 'headache_day' || d.dayType === 'migraine_day' ? 1 : 0), 0);
  const mmdMin = daily.reduce((n, d) => n + (d.dayType === 'migraine_day' ? 1 : 0), 0);

  const totals: OutcomesTotals = {
    mmdMin,
    mmdMax: mmdMin + missingDays,
    mhdMin,
    mhdMax: mhdMin + missingDays,
    acuteMedicationDays: daily.reduce((n, d) => n + (d.tookMedication ? 1 : 0), 0),
    coverage: { totalDays, recordedDays, missingDays },
  };

  return { windowDays, timezone, totals, daily };
}

export function computeResponder50(args: {
  baselineMmd: number;
  currentMmd: number;
}): { status: 'YES' | 'NO' | 'NA'; baselineMmd?: number; currentMmd?: number } {
  const { baselineMmd, currentMmd } = args;
  if (baselineMmd === 0) {
    return { status: 'NA' };
  }
  return {
    status: currentMmd <= baselineMmd * 0.5 ? 'YES' : 'NO',
    baselineMmd,
    currentMmd,
  };
}

export function resolveWindowRange(args: {
  timezone: string;
  windowDays: number;
  to?: string; // YYYY-MM-DD local; defaults to "today" in timezone
}): { from: string; to: string } {
  const { timezone, windowDays } = args;
  const to = args.to
    ? DateTime.fromISO(args.to, { zone: timezone }).toISODate()!
    : DateTime.now().setZone(timezone).toISODate()!;
  const from = DateTime.fromISO(to, { zone: timezone })
    .minus({ days: windowDays - 1 })
    .toISODate()!;
  return { from, to };
}

export function resolveBaselineRange(args: {
  timezone: string;
  windowDays: number;
  baselineStart: Date | null;
  baselineEnd: Date | null;
}): { from: string; to: string } | null {
  const { timezone, windowDays, baselineStart, baselineEnd } = args;
  if (!baselineStart && !baselineEnd) {
    return null;
  }

  if (baselineStart) {
    const from = DateTime.fromJSDate(baselineStart).setZone(timezone).toISODate()!;
    const to = DateTime.fromISO(from, { zone: timezone })
      .plus({ days: windowDays - 1 })
      .toISODate()!;
    return { from, to };
  }

  const to = DateTime.fromJSDate(baselineEnd!).setZone(timezone).toISODate()!;
  const from = DateTime.fromISO(to, { zone: timezone })
    .minus({ days: windowDays - 1 })
    .toISODate()!;
  return { from, to };
}
