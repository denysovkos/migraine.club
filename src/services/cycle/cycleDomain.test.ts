import { describe, expect, it } from 'vitest';

import {
  buildRelativeAttackHistogram,
  computeBleedingStartDates,
  getCycleDay,
  getLastBleedStart,
  getRelativeDay,
  isInPerimenstrualWindow,
  normalizeDate,
} from '@/services/cycle/cycleDomain';

describe('cycleDomain', () => {
  it('normalizes YYYY-MM-DD and Date inputs', () => {
    expect(normalizeDate('2026-03-01')).toBe('2026-03-01');
    expect(normalizeDate(new Date('2026-03-01T12:00:00.000Z'))).toBe('2026-03-01');
  });

  it('computes start dates from consecutive bleeding days', () => {
    const bleedingDays = new Set([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-31',
      '2026-02-01',
      '2026-03-10',
    ]);

    expect(computeBleedingStartDates(bleedingDays)).toEqual([
      '2026-01-01',
      '2026-01-31',
      '2026-03-10',
    ]);
  });

  it('returns last bleed start and cycle day when available', () => {
    const starts = ['2026-01-01', '2026-01-29', '2026-02-26'];

    expect(getLastBleedStart('2026-02-02', starts)).toBe('2026-01-29');
    expect(getCycleDay('2026-02-02', '2026-01-29')).toBe(5);
    expect(getCycleDay('2026-01-15', null)).toBeNull();
  });

  it('handles uncertain cycle context before first start', () => {
    const starts = ['2026-02-01'];

    expect(getLastBleedStart('2026-01-20', starts)).toBeNull();
    expect(getRelativeDay('2026-01-20', null)).toBeNull();
  });

  it('checks perimenstrual window membership', () => {
    expect(isInPerimenstrualWindow('2026-02-03', '2026-02-01', -2, 3)).toBe(true);
    expect(isInPerimenstrualWindow('2026-01-30', '2026-02-01', -2, 3)).toBe(true);
    expect(isInPerimenstrualWindow('2026-01-28', '2026-02-01', -2, 3)).toBe(false);
  });

  it('builds relative-day histogram across sparse logs', () => {
    const starts = ['2026-01-01', '2026-01-30', '2026-02-27'];
    const attacks = [
      '2025-12-31', // -1 from Jan 1
      '2026-01-01', // 0
      '2026-01-02', // +1
      '2026-01-29', // -1 from Jan 30
      '2026-01-30', // 0
      '2026-03-02', // +3 from Feb 27
      '2026-04-20', // out of range
    ];
    const histogram = buildRelativeAttackHistogram(attacks, starts, -2, 3);

    expect(histogram.get(-2)).toBe(0);
    expect(histogram.get(-1)).toBe(2);
    expect(histogram.get(0)).toBe(2);
    expect(histogram.get(1)).toBe(1);
    expect(histogram.get(2)).toBe(0);
    expect(histogram.get(3)).toBe(1);
  });
});
