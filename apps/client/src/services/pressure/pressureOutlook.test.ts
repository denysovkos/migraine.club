import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  buildPressureOutlook,
  findUpcomingDrop,
  isValidThreshold,
  MAX_THRESHOLD_HPA,
  MIN_THRESHOLD_HPA,
} from './pressureOutlook';

const TZ = 'Europe/Berlin';

/** One point per local day at 12:00 in TZ, starting at `start`. */
function series(start: string, pressures: number[]) {
  return pressures.map((pressureHpa, i) => ({
    dt: DateTime.fromISO(`${start}T12:00:00`, { zone: TZ }).plus({ days: i }).toSeconds(),
    pressureHpa,
  }));
}

describe('buildPressureOutlook', () => {
  it('returns day-over-day change and flags falls at or above the threshold', () => {
    const days = buildPressureOutlook(series('2026-11-18', [1020, 1018, 1012, 1013, 1005]), TZ, 5, '2026-11-18');

    expect(days.map(d => [d.date, d.changeHpa, d.dropAtOrAboveThreshold])).toEqual([
      ['2026-11-18', null, false],
      ['2026-11-19', -2, false],
      ['2026-11-20', -6, true],
      ['2026-11-21', 1, false],
      ['2026-11-22', -8, true],
    ]);
  });

  it('treats a fall exactly equal to the threshold as meeting it', () => {
    const days = buildPressureOutlook(series('2026-11-18', [1015, 1010]), TZ, 5, '2026-11-18');

    expect(days[1]!.dropAtOrAboveThreshold).toBe(true);
  });

  it('never flags rises, however large', () => {
    const days = buildPressureOutlook(series('2026-11-18', [1000, 1020]), TZ, 5, '2026-11-18');

    expect(days[1]!.dropAtOrAboveThreshold).toBe(false);
  });

  it('drops past days but keeps them as the baseline for today', () => {
    const days = buildPressureOutlook(series('2026-11-17', [1020, 1013, 1012]), TZ, 5, '2026-11-18');

    expect(days[0]).toEqual({ date: '2026-11-18', pressureHpa: 1013, changeHpa: -7, dropAtOrAboveThreshold: true });
    expect(days).toHaveLength(2);
  });

  it('buckets by the user timezone, not UTC', () => {
    // 23:30 UTC on the 18th is already the 19th in Tokyo.
    const dt = DateTime.fromISO('2026-11-18T23:30:00Z').toSeconds();
    const days = buildPressureOutlook([{ dt, pressureHpa: 1010 }], 'Asia/Tokyo', 5, '2026-11-18');

    expect(days[0]!.date).toBe('2026-11-19');
  });

  it('keeps the first point when two land on the same local day', () => {
    const base = DateTime.fromISO('2026-11-18T08:00:00', { zone: TZ }).toSeconds();
    const days = buildPressureOutlook(
      [{ dt: base + 3600, pressureHpa: 900 }, { dt: base, pressureHpa: 1010 }],
      TZ,
      5,
      '2026-11-18',
    );

    expect(days).toEqual([{ date: '2026-11-18', pressureHpa: 1010, changeHpa: null, dropAtOrAboveThreshold: false }]);
  });

  it('caps the number of days and skips non-finite values', () => {
    const points = series('2026-11-18', [1, 2, 3, 4, 5, 6, 7, 8].map(n => 1000 + n));
    points.push({ dt: Number.NaN, pressureHpa: 1000 });
    const days = buildPressureOutlook(points, TZ, 5, '2026-11-18', 3);

    expect(days.map(d => d.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
  });

  it('rounds to one decimal', () => {
    const days = buildPressureOutlook(series('2026-11-18', [1013.27, 1007.04]), TZ, 5, '2026-11-18');

    expect(days[1]).toMatchObject({ pressureHpa: 1007, changeHpa: -6.2 });
  });

  it('returns an empty outlook for no data', () => {
    expect(buildPressureOutlook([], TZ, 5, '2026-11-18')).toEqual([]);
  });
});

describe('findUpcomingDrop', () => {
  const outlook = buildPressureOutlook(series('2026-11-18', [1020, 1019, 1010, 1000]), TZ, 5, '2026-11-18');

  it('finds the first qualifying day within the next two days', () => {
    expect(findUpcomingDrop(outlook, '2026-11-18')?.date).toBe('2026-11-20');
  });

  it('ignores today and days beyond the horizon', () => {
    const todayDrop = buildPressureOutlook(series('2026-11-17', [1020, 1010, 1010, 1010, 1000]), TZ, 5, '2026-11-18');

    expect(findUpcomingDrop(todayDrop, '2026-11-18')).toBeNull();
    expect(findUpcomingDrop(outlook, '2026-11-18', 1)).toBeNull();
  });
});

describe('isValidThreshold', () => {
  it('accepts the configured range and rejects everything else', () => {
    expect(isValidThreshold(MIN_THRESHOLD_HPA)).toBe(true);
    expect(isValidThreshold(MAX_THRESHOLD_HPA)).toBe(true);
    expect(isValidThreshold(0)).toBe(false);
    expect(isValidThreshold(MAX_THRESHOLD_HPA + 1)).toBe(false);
    expect(isValidThreshold(Number.NaN)).toBe(false);
    expect(isValidThreshold('5')).toBe(false);
  });
});
