import { describe, expect, it } from 'vitest';

import { computeSleepDailySignal } from './sleepAdherence';

const target = { bedTime: '23:00', wakeTime: '07:00', toleranceMinutes: 30 };

describe('computeSleepDailySignal', () => {
  it('hit when both times within tolerance', () => {
    expect(computeSleepDailySignal({ target, bedTime: '23:18', wakeTime: '06:52' })).toBe('hit');
    expect(computeSleepDailySignal({ target, bedTime: '22:30', wakeTime: '07:30' })).toBe('hit');
  });

  it('miss when either is outside tolerance', () => {
    expect(computeSleepDailySignal({ target, bedTime: '01:30', wakeTime: '07:00' })).toBe('miss');
    expect(computeSleepDailySignal({ target, bedTime: '23:00', wakeTime: '08:30' })).toBe('miss');
  });

  it('na when either time missing', () => {
    expect(computeSleepDailySignal({ target, bedTime: null, wakeTime: '07:00' })).toBe('na');
    expect(computeSleepDailySignal({ target, bedTime: '23:00', wakeTime: null })).toBe('na');
    expect(computeSleepDailySignal({ target, bedTime: null, wakeTime: null })).toBe('na');
  });

  it('treats midnight wraparound as +90 min from 23:00 target', () => {
    expect(computeSleepDailySignal({ target, bedTime: '00:30', wakeTime: '07:00' })).toBe('miss');
  });

  it('hit when bed-time crosses midnight but stays within widened tolerance', () => {
    expect(computeSleepDailySignal({
      target: { ...target, toleranceMinutes: 90 },
      bedTime: '00:25',
      wakeTime: '07:00',
    })).toBe('hit');
  });
});
