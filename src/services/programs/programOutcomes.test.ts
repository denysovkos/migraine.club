import { describe, expect, it } from 'vitest';

import { combineOutcomeWindows } from './programOutcomes';

describe('combineOutcomeWindows', () => {
  it('reports reduction with correct percent change', () => {
    const result = combineOutcomeWindows({
      baseline: { headacheDays: 11, totalDays: 28 },
      evaluation: { headacheDays: 7, totalDays: 28 },
    });

    expect(result.percentChange).toBeCloseTo(-0.3636, 3);
    expect(result.directionLabel).toBe('reduced');
  });

  it('reports increase when eval > baseline', () => {
    const result = combineOutcomeWindows({
      baseline: { headacheDays: 5, totalDays: 28 },
      evaluation: { headacheDays: 10, totalDays: 28 },
    });

    expect(result.directionLabel).toBe('increased');
  });

  it('handles zero baseline gracefully', () => {
    const same = combineOutcomeWindows({
      baseline: { headacheDays: 0, totalDays: 28 },
      evaluation: { headacheDays: 0, totalDays: 28 },
    });
    const worse = combineOutcomeWindows({
      baseline: { headacheDays: 0, totalDays: 28 },
      evaluation: { headacheDays: 4, totalDays: 28 },
    });

    expect(same.percentChange).toBe(0);
    expect(same.directionLabel).toBe('no_change');
    expect(worse.directionLabel).toBe('increased');
  });
});
