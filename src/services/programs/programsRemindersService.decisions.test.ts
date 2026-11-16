import { describe, expect, it } from 'vitest';

import { isOnsetNudgeDue, shouldSuppressForMoh } from './programsRemindersService';

describe('shouldSuppressForMoh', () => {
  it('suppresses on exceeded', () => {
    expect(shouldSuppressForMoh('exceeded')).toBe(true);
  });

  it('suppresses on approaching (program goal is earlier dosing, not more doses)', () => {
    expect(shouldSuppressForMoh('approaching')).toBe(true);
  });

  it('allows on ok', () => {
    expect(shouldSuppressForMoh('ok')).toBe(false);
  });
});

describe('isOnsetNudgeDue', () => {
  const onsetTime = new Date('2026-05-05T10:00:00Z');

  it('not due before delay', () => {
    expect(isOnsetNudgeDue({
      now: new Date('2026-05-05T10:25:00Z'),
      onsetTime,
      delayMinutes: 30,
      windowMinutes: 6,
    })).toBe(false);
  });

  it('due at exactly delay', () => {
    expect(isOnsetNudgeDue({
      now: new Date('2026-05-05T10:30:00Z'),
      onsetTime,
      delayMinutes: 30,
      windowMinutes: 6,
    })).toBe(true);
  });

  it('due within window', () => {
    expect(isOnsetNudgeDue({
      now: new Date('2026-05-05T10:35:00Z'),
      onsetTime,
      delayMinutes: 30,
      windowMinutes: 6,
    })).toBe(true);
  });

  it('not due past window', () => {
    expect(isOnsetNudgeDue({
      now: new Date('2026-05-05T10:37:00Z'),
      onsetTime,
      delayMinutes: 30,
      windowMinutes: 6,
    })).toBe(false);
  });

  it('not due far in the future (already passed)', () => {
    expect(isOnsetNudgeDue({
      now: new Date('2026-05-05T12:00:00Z'),
      onsetTime,
      delayMinutes: 30,
      windowMinutes: 6,
    })).toBe(false);
  });
});
