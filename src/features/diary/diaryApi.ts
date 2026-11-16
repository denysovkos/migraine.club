'use client';

export type DiaryTodayResponse = {
  timezone: string;
  todayLocalDate: string;
  entry: {
    id: string;
    userId: string;
    localDate: string;
    timezone: string;
    dayType: 'headache_free' | 'headache_day' | 'migraine_day';
    createdFrom: 'user' | 'attack';
    impact: number | null;
    notes: string | null;
    bedTimeLocal: string | null;
    wakeTimeLocal: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export type DiaryRangeResponse = {
  timezone: string;
  entries: DiaryTodayResponse['entry'][];
  attackDays: string[];
  medicationDays: string[];
  coverage: { totalDays: number; recordedDays: number; missingDays: number };
};

export async function fetchTodayDiary(): Promise<DiaryTodayResponse> {
  const res = await fetch('/api/diary/today', { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to load today diary state');
  }
  return await res.json();
}

export async function upsertDiaryEntry(args: {
  localDate: string;
  patch: Partial<{
    dayType: 'headache_free' | 'headache_day' | 'migraine_day';
    impact: number | null;
    notes: string | null;
    bedTimeLocal: string | null;
    wakeTimeLocal: string | null;
  }>;
}): Promise<NonNullable<DiaryTodayResponse['entry']>> {
  const res = await fetch('/api/diary/entry', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? 'Failed to save diary entry';
    const err = new Error(msg) as Error & { code?: string };
    err.code = body?.code;
    throw err;
  }
  return await res.json();
}

export async function fetchDiaryRange(args: {
  from: string;
  to: string;
}): Promise<DiaryRangeResponse> {
  const url = new URL('/api/diary/range', window.location.origin);
  url.searchParams.set('from', args.from);
  url.searchParams.set('to', args.to);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to load diary range');
  }
  return await res.json();
}

export async function fetchOverlapDays(args: {
  from: string;
  to: string;
}): Promise<Set<string>> {
  const url = new URL('/api/diary/overlap', window.location.origin);
  url.searchParams.set('from', args.from);
  url.searchParams.set('to', args.to);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to load episode overlap');
  }
  const data = await res.json();
  return new Set<string>((data?.overlapDays ?? []) as string[]);
}

export type DiaryDayDetailResponse = {
  timezone: string;
  entry: DiaryTodayResponse['entry'];
  attacks: Array<{
    id: number;
    attackType: 'migraine' | 'headache';
    startTime: string;
    endTime: string | null;
    isOngoing: boolean;
    intensity: number;
    triggers: string[];
    protectors: string[];
  }>;
  medicationIntakes: Array<{
    id: string;
    takenAt: string;
    label: string;
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
  }>;
  preventiveIntakes: Array<{
    id: string;
    planId: string;
    label: string;
    doseText: string | null;
    state: string;
    takenAt: string | null;
  }>;
};

export async function fetchDiaryDayDetail(args: { date: string }): Promise<DiaryDayDetailResponse> {
  const url = new URL('/api/diary/day', window.location.origin);
  url.searchParams.set('date', args.date);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to load day detail');
  }
  return await res.json();
}
