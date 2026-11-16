import { describe, expect, it } from 'vitest';

import { computeOutcomesForRange, computeResponder50 } from './computeOutcomes';
import { getLocalDatesOverlappedByRange, toLocalISODate } from './localDateOverlap';

describe('getLocalDatesOverlappedByRange', () => {
  it('counts both days when an episode spans midnight (UTC)', () => {
    const days = getLocalDatesOverlappedByRange({
      timezone: 'UTC',
      start: new Date('2024-01-01T23:00:00Z'),
      end: new Date('2024-01-02T01:00:00Z'),
    });

    expect([...days].sort()).toEqual(['2024-01-01', '2024-01-02']);
  });

  it('does not count the next day when end is exactly midnight (end-exclusive)', () => {
    const days = getLocalDatesOverlappedByRange({
      timezone: 'UTC',
      start: new Date('2024-01-01T23:00:00Z'),
      end: new Date('2024-01-02T00:00:00Z'),
    });

    expect([...days].sort()).toEqual(['2024-01-01']);
  });
});

describe('computeOutcomesForRange', () => {
  it('buckets medication days by user timezone', () => {
    // 2024-01-14 23:30Z is 2024-01-15 local in Europe/Berlin (winter)
    const localDate = toLocalISODate({
      timezone: 'Europe/Berlin',
      instant: new Date('2024-01-14T23:30:00Z'),
    });

    expect(localDate).toBe('2024-01-15');
  });

  it('counts medication days as distinct local calendar days', () => {
    const result = computeOutcomesForRange({
      timezone: 'UTC',
      windowDays: 28,
      from: '2024-01-01',
      to: '2024-01-03',
      diaryDays: [],
      medicationIntakes: [
        { takenAt: new Date('2024-01-01T08:00:00Z') },
        { takenAt: new Date('2024-01-01T12:00:00Z') }, // same day -> still 1
        { takenAt: new Date('2024-01-03T00:01:00Z') }, // another day
      ],
    });

    expect(result.totals.acuteMedicationDays).toBe(2);
  });

  it('does not treat missing diary days as headache-free', () => {
    const result = computeOutcomesForRange({
      timezone: 'UTC',
      windowDays: 28,
      from: '2024-01-01',
      to: '2024-01-03',
      diaryDays: [
        { localDate: '2024-01-02', dayType: 'headache_free' },
      ],
      medicationIntakes: [],
    });

    expect(result.totals.coverage.totalDays).toBe(3);
    expect(result.totals.coverage.recordedDays).toBe(1);
    expect(result.totals.coverage.missingDays).toBe(2);
    // Missing days are unknown; max assumes missing days could have been migraine days.
    expect(result.totals.mmdMin).toBe(0);
    expect(result.totals.mmdMax).toBe(2);
  });

  it('counts MHD/MMD from dayType among recorded days only', () => {
    const result = computeOutcomesForRange({
      timezone: 'UTC',
      windowDays: 28,
      from: '2024-01-01',
      to: '2024-01-03',
      diaryDays: [
        { localDate: '2024-01-01', dayType: 'migraine_day' },
        { localDate: '2024-01-02', dayType: 'headache_day' },
        { localDate: '2024-01-03', dayType: 'headache_free' },
      ],
      medicationIntakes: [],
    });

    expect(result.totals.mmdMin).toBe(1);
    expect(result.totals.mhdMin).toBe(2);
  });

  it('computes conservative ranges when missing exists', () => {
    const result = computeOutcomesForRange({
      timezone: 'UTC',
      windowDays: 28,
      from: '2024-01-01',
      to: '2024-01-03',
      diaryDays: [{ localDate: '2024-01-02', dayType: 'migraine_day' }],
      medicationIntakes: [],
    });

    expect(result.totals.mmdMin).toBe(1);
    expect(result.totals.mmdMax).toBe(3);
  });
});

describe('computeResponder50', () => {
  it('returns NA when baseline MMD is 0', () => {
    expect(computeResponder50({ baselineMmd: 0, currentMmd: 2 })).toEqual({ status: 'NA' });
  });

  it('returns YES when current MMD is <= 50% of baseline', () => {
    expect(computeResponder50({ baselineMmd: 10, currentMmd: 5 }).status).toBe('YES');
    expect(computeResponder50({ baselineMmd: 10, currentMmd: 4 }).status).toBe('YES');
  });

  it('returns NO when current MMD is > 50% of baseline', () => {
    expect(computeResponder50({ baselineMmd: 10, currentMmd: 6 }).status).toBe('NO');
  });
});
