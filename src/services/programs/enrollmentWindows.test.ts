import { describe, expect, it } from 'vitest';

import { computeEnrollmentWindows } from './enrollmentWindows';

describe('computeEnrollmentWindows', () => {
  it('places baseline 28d immediately before startDate', () => {
    const w = computeEnrollmentWindows({ startDate: '2026-05-01', timezone: 'UTC' });

    expect(w.baselineWindowStart).toBe('2026-04-03');
    expect(w.baselineWindowEnd).toBe('2026-04-30');
  });

  it('places eval days 15-42 after startDate (14d ramp + 28d window)', () => {
    const w = computeEnrollmentWindows({ startDate: '2026-05-01', timezone: 'UTC' });

    expect(w.evaluationWindowStart).toBe('2026-05-15');
    expect(w.evaluationWindowEnd).toBe('2026-06-11');
  });

  it('respects timezone when computing local-date boundaries', () => {
    // A fixed startDate with a different IANA zone should still resolve to the same calendar date.
    const w = computeEnrollmentWindows({ startDate: '2026-05-01', timezone: 'Europe/Berlin' });

    expect(w.baselineWindowStart).toBe('2026-04-03');
    expect(w.evaluationWindowStart).toBe('2026-05-15');
  });
});
