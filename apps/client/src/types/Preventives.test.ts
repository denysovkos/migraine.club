import { describe, expect, it } from 'vitest';

import {
  MAX_REMINDER_TIMES,
  normalizeReminderTimes,
  REMINDER_TIME_OPTIONS,
  REMINDER_TIME_REGEX,
} from './Preventives';

describe('reminder time slots', () => {
  it('offers every half-hour slot of the day', () => {
    expect(REMINDER_TIME_OPTIONS).toHaveLength(48);
    expect(REMINDER_TIME_OPTIONS[0]).toBe('00:00');
    expect(REMINDER_TIME_OPTIONS[1]).toBe('00:30');
    expect(REMINDER_TIME_OPTIONS.at(-1)).toBe('23:30');
  });

  it('accepts every offered slot', () => {
    for (const time of REMINDER_TIME_OPTIONS) {
      expect(REMINDER_TIME_REGEX.test(time)).toBe(true);
    }
  });

  it('rejects times off the half hour', () => {
    // The cron ticks every 30 minutes, so 09:27 could only ever fire at 09:30.
    expect(REMINDER_TIME_REGEX.test('09:27')).toBe(false);
    expect(REMINDER_TIME_REGEX.test('08:15')).toBe(false);
    expect(REMINDER_TIME_REGEX.test('24:00')).toBe(false);
    expect(REMINDER_TIME_REGEX.test('9:30')).toBe(false);
  });

  it('sorts, de-duplicates and caps on write', () => {
    expect(normalizeReminderTimes(['21:00', '09:30', '09:30'])).toEqual(['09:30', '21:00']);
    expect(
      normalizeReminderTimes(REMINDER_TIME_OPTIONS),
    ).toHaveLength(MAX_REMINDER_TIMES);
  });
});
