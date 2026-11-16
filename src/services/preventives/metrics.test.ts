import { describe, expect, it } from 'vitest';

import { resolvePlanWindows } from './metrics';

describe('resolvePlanWindows', () => {
  it('calculates baseline and evaluation windows with local dates', () => {
    const res = resolvePlanWindows({
      startDate: '2025-01-15',
      todayLocalDate: '2025-03-01',
      timezone: 'Europe/Berlin',
    });

    expect(res.baselineFrom).toBe('2024-12-18');
    expect(res.baselineTo).toBe('2025-01-14');
    expect(res.evalFrom).toBe('2025-01-29');
    expect(res.evalTo).toBe('2025-02-25');
    expect(res.evalEnd).toBe('2025-02-25');
  });

  it('caps evaluation at today when data is incomplete', () => {
    const res = resolvePlanWindows({
      startDate: '2025-01-15',
      todayLocalDate: '2025-02-05',
      timezone: 'Europe/Berlin',
    });

    expect(res.evalEnd).toBe('2025-02-05');
    expect(res.hasEvalData).toBe(true);
  });
});
