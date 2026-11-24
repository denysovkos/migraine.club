'use client';

import type { CycleFlowType, CycleHormoneProfileType, CyclePrivacyModeType } from '@migraine/db/schema';

export type CycleSettings = {
  enabled: boolean;
  includeInExports: boolean;
  privacyMode: CyclePrivacyModeType;
  perimenstrualWindowStartDays: number;
  perimenstrualWindowEndDays: number;
  hormoneProfile: CycleHormoneProfileType;
  updatedAt: string | null;
};

export type CycleCalendarDay = {
  localDate: string;
  bleeding: boolean;
  flow: CycleFlowType;
};

export async function fetchCycleSettings(): Promise<CycleSettings> {
  const res = await fetch('/api/cycle/settings', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load cycle settings');
  }
  return await res.json();
}

export async function updateCycleSettings(patch: Partial<CycleSettings>): Promise<CycleSettings> {
  const res = await fetch('/api/cycle/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error ?? 'Failed to update cycle settings');
  }
  return await res.json();
}

export async function toggleBleedingDay(localDate: string): Promise<CycleCalendarDay> {
  const res = await fetch('/api/cycle/bleeding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localDate }),
  });
  if (!res.ok) {
    throw new Error('Failed to toggle bleeding day');
  }
  return await res.json();
}

export async function saveBleedingDay(args: {
  localDate: string;
  bleeding: boolean;
  flow?: CycleFlowType;
}): Promise<CycleCalendarDay> {
  const res = await fetch('/api/cycle/bleeding', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error('Failed to save bleeding day');
  }
  return await res.json();
}

export async function updateBleedingFlow(args: {
  localDate: string;
  flow: CycleFlowType;
}): Promise<CycleCalendarDay> {
  const res = await fetch('/api/cycle/bleeding', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error('Failed to update flow');
  }
  return await res.json();
}

export async function deleteAllCycleData(): Promise<void> {
  const res = await fetch('/api/cycle/data', { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Failed to delete cycle data');
  }
}

export async function fetchCycleCalendar(args: {
  from: string;
  to: string;
}): Promise<{
  timezone: string;
  from: string;
  to: string;
  days: CycleCalendarDay[];
  bleedingStartDates: string[];
  migraineDays: string[];
}> {
  const url = new URL('/api/cycle/calendar', window.location.origin);
  url.searchParams.set('from', args.from);
  url.searchParams.set('to', args.to);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load cycle calendar');
  }
  return await res.json();
}

export async function fetchCycleContext(date: string): Promise<{
  date: string;
  enabled: boolean;
  cycleDay: number | null;
  relativeDay: number | null;
  withinPerimenstrualWindow: boolean;
  anchorBleedStartDate: string | null;
}> {
  const url = new URL('/api/cycle/context', window.location.origin);
  url.searchParams.set('date', date);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load cycle context');
  }
  return await res.json();
}

export async function fetchCycleInsights(args?: {
  from?: string;
  to?: string;
}) {
  const url = new URL('/api/cycle/insights', window.location.origin);
  if (args?.from) {
    url.searchParams.set('from', args.from);
  }
  if (args?.to) {
    url.searchParams.set('to', args.to);
  }
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load cycle insights');
  }
  return await res.json();
}
