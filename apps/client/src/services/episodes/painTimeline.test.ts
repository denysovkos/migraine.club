import { describe, expect, it } from 'vitest';

import {
  attackWindow,
  checkReadingTime,
  FUTURE_SKEW_MS,
  midnightsBetween,
  peakIntensity,
  sortReadings,
} from './painTimeline';

const d = (iso: string) => new Date(iso);

describe('attackWindow', () => {
  it('starts at the reported onset when it is earlier than the logged start', () => {
    expect(attackWindow({
      startTime: d('2026-11-17T10:00:00Z'),
      onsetAt: d('2026-11-17T08:00:00Z'),
      endTime: d('2026-11-17T12:00:00Z'),
      isOngoing: false,
    })).toEqual({ start: d('2026-11-17T08:00:00Z'), end: d('2026-11-17T12:00:00Z') });
  });

  it('ignores an onset later than the start, and has no end while ongoing', () => {
    expect(attackWindow({
      startTime: d('2026-11-17T10:00:00Z'),
      onsetAt: d('2026-11-17T11:00:00Z'),
      endTime: d('2026-11-17T12:00:00Z'),
      isOngoing: true,
    })).toEqual({ start: d('2026-11-17T10:00:00Z'), end: null });
  });
});

describe('checkReadingTime', () => {
  const now = d('2026-11-18T12:00:00Z');
  const ended = { start: d('2026-11-16T22:00:00Z'), end: d('2026-11-18T06:00:00Z') };
  const ongoing = { start: d('2026-11-16T22:00:00Z'), end: null };

  it('accepts readings across midnight and over several days', () => {
    expect(checkReadingTime(d('2026-11-16T22:00:00Z'), ended, now)).toEqual({ ok: true });
    expect(checkReadingTime(d('2026-11-17T01:30:00Z'), ended, now)).toEqual({ ok: true });
    expect(checkReadingTime(d('2026-11-18T06:00:00Z'), ended, now)).toEqual({ ok: true });
  });

  it('rejects readings before the attack started', () => {
    expect(checkReadingTime(d('2026-11-16T21:59:59Z'), ended, now)).toEqual({ ok: false, reason: 'before_start' });
  });

  it('rejects readings after the attack ended', () => {
    expect(checkReadingTime(d('2026-11-18T06:00:01Z'), ended, now)).toEqual({ ok: false, reason: 'after_end' });
  });

  it('allows a little clock skew but rejects future readings', () => {
    expect(checkReadingTime(new Date(now.getTime() + FUTURE_SKEW_MS), ongoing, now)).toEqual({ ok: true });
    expect(checkReadingTime(new Date(now.getTime() + FUTURE_SKEW_MS + 1), ongoing, now))
      .toEqual({ ok: false, reason: 'in_future' });
  });
});

describe('sortReadings / peakIntensity', () => {
  it('orders readings by time and finds the peak', () => {
    const readings = [
      { id: 'b', recordedAt: d('2026-11-17T03:00:00Z'), intensity: 2 },
      { id: 'a', recordedAt: d('2026-11-17T01:00:00Z'), intensity: 5 },
    ];

    expect(sortReadings(readings).map(r => r.id)).toEqual(['a', 'b']);
    expect(peakIntensity(readings)).toBe(5);
    expect(peakIntensity([])).toBeNull();
  });
});

describe('midnightsBetween', () => {
  it('returns each local midnight crossed, in the given timezone', () => {
    const marks = midnightsBetween(d('2026-11-16T20:00:00Z'), d('2026-11-18T10:00:00Z'), 'Europe/Berlin');

    expect(marks.map(m => m.toISOString())).toEqual([
      '2026-11-16T23:00:00.000Z',
      '2026-11-17T23:00:00.000Z',
    ]);
  });

  it('returns nothing for an attack within one day or an empty range', () => {
    expect(midnightsBetween(d('2026-11-17T08:00:00Z'), d('2026-11-17T12:00:00Z'), 'Europe/Berlin')).toEqual([]);
    expect(midnightsBetween(d('2026-11-17T12:00:00Z'), d('2026-11-17T08:00:00Z'), 'UTC')).toEqual([]);
  });

  it('falls back to UTC for an unknown timezone', () => {
    const marks = midnightsBetween(d('2026-11-16T20:00:00Z'), d('2026-11-17T10:00:00Z'), 'Not/AZone');

    expect(marks.map(m => m.toISOString())).toEqual(['2026-11-17T00:00:00.000Z']);
  });
});
