import { describe, expect, it } from 'vitest';
import { applyQueuedDiaryPatch, reconcileTodayWithDeviceClock } from './diaryApi';

const entry = {
  id: 'e1',
  userId: 'user_a',
  localDate: '2026-11-15',
  timezone: 'Europe/Berlin',
  dayType: 'headache_day' as const,
  createdFrom: 'user' as const,
  impact: 2,
  notes: 'old',
  bedTimeLocal: null,
  wakeTimeLocal: null,
  createdAt: '2026-11-15T08:00:00Z',
  updatedAt: '2026-11-15T08:00:00Z',
};

describe('reconcileTodayWithDeviceClock', () => {
  it('keeps a fresh response as is', () => {
    const data = { timezone: 'Europe/Berlin', todayLocalDate: '2026-11-15', entry };

    expect(reconcileTodayWithDeviceClock(data, new Date('2026-11-15T20:00:00Z'))).toBe(data);
  });

  it('moves a stale cached response to the device day in the user timezone', () => {
    const data = { timezone: 'Europe/Berlin', todayLocalDate: '2026-11-15', entry };
    // 23:30 UTC on the 15th is already the 16th in Berlin.
    const out = reconcileTodayWithDeviceClock(data, new Date('2026-11-15T23:30:00Z'));

    expect(out.todayLocalDate).toBe('2026-11-16');
    expect(out.entry).toBeNull();
  });

  it('ignores an unknown timezone', () => {
    const data = { timezone: 'Not/AZone', todayLocalDate: '2026-11-15', entry };

    expect(reconcileTodayWithDeviceClock(data, new Date('2026-11-20T12:00:00Z'))).toBe(data);
  });
});

describe('applyQueuedDiaryPatch', () => {
  it('merges the patch over the previous entry', () => {
    const out = applyQueuedDiaryPatch(entry, '2026-11-15', { notes: 'new' });

    expect(out).toMatchObject({ id: 'e1', dayType: 'headache_day', notes: 'new', impact: 2 });
  });

  it('creates a local stand-in when there was no entry', () => {
    const out = applyQueuedDiaryPatch(null, '2026-11-16', { dayType: 'headache_free' });

    expect(out).toMatchObject({ id: 'offline:2026-11-16', localDate: '2026-11-16', dayType: 'headache_free' });
  });

  it('returns nothing to show when the day type is unknown', () => {
    expect(applyQueuedDiaryPatch(null, '2026-11-16', { notes: 'x' })).toBeNull();
  });
});
