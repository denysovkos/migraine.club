import { describe, expect, it } from 'vitest';

import { shouldRecomputeWpiForKpChange } from './wpiSolarSync';

describe('shouldRecomputeWpiForKpChange', () => {
  it('does not recompute if current avgKp is null', () => {
    expect(shouldRecomputeWpiForKpChange({ recentKp: 1, currentAvgKp: null })).toBe(false);
    expect(shouldRecomputeWpiForKpChange({ recentKp: null, currentAvgKp: null })).toBe(false);
  });

  it('recomputes if snapshot had no Kp but current avgKp exists', () => {
    expect(shouldRecomputeWpiForKpChange({ recentKp: null, currentAvgKp: 0.5 })).toBe(true);
  });

  it('recomputes if values differ', () => {
    expect(shouldRecomputeWpiForKpChange({ recentKp: 0.7, currentAvgKp: 0.5 })).toBe(true);
  });

  it('does not recompute if values match (within float noise)', () => {
    expect(shouldRecomputeWpiForKpChange({ recentKp: 0.5, currentAvgKp: 0.5 })).toBe(false);
    expect(shouldRecomputeWpiForKpChange({ recentKp: 0.5000000001, currentAvgKp: 0.5 })).toBe(false);
  });
});
