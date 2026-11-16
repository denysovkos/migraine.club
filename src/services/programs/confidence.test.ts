import { describe, expect, it } from 'vitest';

import { computeConfidence } from './confidence';

describe('computeConfidence', () => {
  it('low when coverage < 70%', () => {
    expect(computeConfidence({ coverage: 0.5, adherence: 0.8, evalComplete: true })).toBe('low');
  });

  it('low when adherence < 40%', () => {
    expect(computeConfidence({ coverage: 0.95, adherence: 0.3, evalComplete: true })).toBe('low');
  });

  it('low when evaluation window not complete', () => {
    expect(computeConfidence({ coverage: 0.95, adherence: 0.8, evalComplete: false })).toBe('low');
  });

  it('high when coverage ≥ 90% and adherence ≥ 70% and complete', () => {
    expect(computeConfidence({ coverage: 0.95, adherence: 0.8, evalComplete: true })).toBe('high');
  });

  it('medium otherwise', () => {
    expect(computeConfidence({ coverage: 0.8, adherence: 0.6, evalComplete: true })).toBe('medium');
  });
});
