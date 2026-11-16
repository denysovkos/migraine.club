import { describe, expect, it } from 'vitest';

import { computeAcuteAttackSignal } from './acuteAdherence';

describe('computeAcuteAttackSignal', () => {
  it('na when no acute dose taken', () => {
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: null })).toEqual({
      signal: 'na',
      onsetToDoseMinutes: null,
    });
  });

  it('hit when delta within target', () => {
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: 24 })).toEqual({
      signal: 'hit',
      onsetToDoseMinutes: 24,
    });
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: 30 })).toEqual({
      signal: 'hit',
      onsetToDoseMinutes: 30,
    });
  });

  it('miss when delta exceeds target', () => {
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: 31 })).toEqual({
      signal: 'miss',
      onsetToDoseMinutes: 31,
    });
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: 90 })).toEqual({
      signal: 'miss',
      onsetToDoseMinutes: 90,
    });
  });

  it('na when delta is negative (dose before onset = bad data)', () => {
    expect(computeAcuteAttackSignal({ targetMinutes: 30, onsetToDoseMinutes: -5 })).toEqual({
      signal: 'na',
      onsetToDoseMinutes: -5,
    });
  });
});
