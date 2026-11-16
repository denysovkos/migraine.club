import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { getLocalDateString, isNotBetween8pmAnd9am } from './DailyRiskAlertService';

describe('isNotBetween8pmAnd9am', () => {
  it('returns false at 08:59 local', () => {
    const dt = DateTime.fromISO('2024-01-15T08:59:00', { zone: 'Europe/Berlin' });

    expect(isNotBetween8pmAnd9am(dt)).toBe(false);
  });

  it('returns true at 09:00 local', () => {
    const dt = DateTime.fromISO('2024-01-15T09:00:00', { zone: 'Europe/Berlin' });

    expect(isNotBetween8pmAnd9am(dt)).toBe(true);
  });

  it('returns true at 19:59 local', () => {
    const dt = DateTime.fromISO('2024-01-15T19:59:00', { zone: 'Europe/Berlin' });

    expect(isNotBetween8pmAnd9am(dt)).toBe(true);
  });

  it('returns false at 20:00 local', () => {
    const dt = DateTime.fromISO('2024-01-15T20:00:00', { zone: 'Europe/Berlin' });

    expect(isNotBetween8pmAnd9am(dt)).toBe(false);
  });
});

describe('getLocalDateString', () => {
  it('returns correct local date for Europe/Berlin', () => {
    // 2024-01-14 23:30:00 UTC is 2024-01-15 00:30:00 in Berlin
    const nowUtc = new Date('2024-01-14T23:30:00Z');
    const result = getLocalDateString('Europe/Berlin', nowUtc);

    expect(result).toBe('2024-01-15');
  });

  it('returns correct local date for UTC', () => {
    const nowUtc = new Date('2024-01-15T12:00:00Z');
    const result = getLocalDateString('UTC', nowUtc);

    expect(result).toBe('2024-01-15');
  });

  it('returns correct local date for America/Los_Angeles', () => {
    // 2024-01-15 07:00:00 UTC is 2024-01-14 23:00:00 in LA (winter)
    const nowUtc = new Date('2024-01-15T07:00:00Z');
    const result = getLocalDateString('America/Los_Angeles', nowUtc);

    expect(result).toBe('2024-01-14');
  });

  it('returns correct local date for Asia/Tokyo', () => {
    // 2024-01-14 16:00:00 UTC is 2024-01-15 01:00:00 in Tokyo
    const nowUtc = new Date('2024-01-14T16:00:00Z');
    const result = getLocalDateString('Asia/Tokyo', nowUtc);

    expect(result).toBe('2024-01-15');
  });

  it('handles date boundary correctly', () => {
    // Just before midnight in LA: 2024-01-15 07:59:00 UTC = 2024-01-14 23:59:00 LA
    const justBefore = new Date('2024-01-15T07:59:00Z');
    const resultBefore = getLocalDateString('America/Los_Angeles', justBefore);

    expect(resultBefore).toBe('2024-01-14');

    // Just after midnight in LA: 2024-01-15 08:01:00 UTC = 2024-01-15 00:01:00 LA
    const justAfter = new Date('2024-01-15T08:01:00Z');
    const resultAfter = getLocalDateString('America/Los_Angeles', justAfter);

    expect(resultAfter).toBe('2024-01-15');
  });
});
