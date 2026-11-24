'use client';

import { sendOrQueue } from '@/libs/offline/outbox';

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
  return reconcileTodayWithDeviceClock(await res.json());
}

function localDateIn(timezone: string, at: Date): string | null {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * Offline, this response may come from the service worker's cache and be from
 * an earlier day. Re-derive "today" from the device clock in the user's
 * timezone so offline entries land on the right day.
 */
export function reconcileTodayWithDeviceClock(data: DiaryTodayResponse, now: Date = new Date()): DiaryTodayResponse {
  const today = data?.timezone ? localDateIn(data.timezone, now) : null;
  if (!today || today === data.todayLocalDate) {
    return data;
  }
  return {
    ...data,
    todayLocalDate: today,
    entry: data.entry?.localDate === today ? data.entry : null,
  };
}

/**
 * Save a diary day. Works offline: when queued, resolves to `null` and the
 * entry syncs later (the payload names its local date, so replay is exact).
 */
export async function upsertDiaryEntry(args: {
  localDate: string;
  patch: Partial<{
    dayType: 'headache_free' | 'headache_day' | 'migraine_day';
    impact: number | null;
    notes: string | null;
    bedTimeLocal: string | null;
    wakeTimeLocal: string | null;
  }>;
}): Promise<NonNullable<DiaryTodayResponse['entry']> | null> {
  const result = await sendOrQueue({
    url: '/api/diary/entry',
    method: 'PUT',
    body: args,
    kind: 'diary',
    label: args.localDate,
  });
  if (result.queued) {
    return null;
  }
  const res = result.response;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? 'Failed to save diary entry';
    const err = new Error(msg) as Error & { code?: string };
    err.code = body?.code;
    throw err;
  }
  return await res.json();
}

type DiaryEntry = NonNullable<DiaryTodayResponse['entry']>;

/**
 * Local stand-in for a diary entry that was queued offline, so the UI can
 * show what the user just recorded. Returns the previous entry unchanged
 * when the day type is unknown.
 */
export function applyQueuedDiaryPatch(
  prev: DiaryEntry | null | undefined,
  localDate: string,
  patch: Partial<Pick<DiaryEntry, 'dayType' | 'impact' | 'notes' | 'bedTimeLocal' | 'wakeTimeLocal'>>,
): DiaryEntry | null {
  const dayType = patch.dayType ?? prev?.dayType;
  if (!dayType) {
    return prev ?? null;
  }
  const nowIso = new Date().toISOString();
  return {
    id: prev?.id ?? `offline:${localDate}`,
    userId: prev?.userId ?? '',
    localDate,
    timezone: prev?.timezone ?? '',
    createdFrom: prev?.createdFrom ?? 'user',
    impact: prev?.impact ?? null,
    notes: prev?.notes ?? null,
    bedTimeLocal: prev?.bedTimeLocal ?? null,
    wakeTimeLocal: prev?.wakeTimeLocal ?? null,
    createdAt: prev?.createdAt ?? nowIso,
    ...patch,
    dayType,
    updatedAt: nowIso,
  };
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
