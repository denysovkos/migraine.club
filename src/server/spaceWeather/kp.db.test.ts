import type { KpReading } from './kp.core';

import { describe, expect, it } from 'vitest';
import { computeAggregateFromReadings } from './kp.core';

describe('DB-backed selection (behavioral)', () => {
  it('does not default missing to 0; returns null when all are stale', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const readings: KpReading[] = [
      { provider: 'noaa', value: 3, timestamp: new Date('2025-12-20T00:00:00Z'), stale: true },
      { provider: 'gfz', value: 4, timestamp: new Date('2025-12-20T00:00:00Z'), stale: true },
    ];
    const agg = computeAggregateFromReadings({ computedAt: nowUtc, readings });

    expect(agg.avgKp).toBeNull();
    expect(agg.sourcesUsed).toBe(0);
    expect(agg.error).toBe('Kp not available');
  });

  it('includes actual 0 values', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const readings: KpReading[] = [
      { provider: 'noaa', value: 0, timestamp: nowUtc, stale: false },
      { provider: 'gfz', value: 2, timestamp: nowUtc, stale: false },
    ];
    const agg = computeAggregateFromReadings({ computedAt: nowUtc, readings });

    expect(agg.avgKp).toBe(1);
    expect(agg.sourcesUsed).toBe(2);
  });
});
