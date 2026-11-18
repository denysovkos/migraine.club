import { describe, expect, it } from 'vitest';

import { buildChartModel, CHART_PAD, CHART_WIDTH, defaultReadingTime, toDateTimeLocalValue } from './painTimelineChart';

const d = (iso: string) => new Date(iso);

describe('buildChartModel', () => {
  it('lays readings out from onset to end, higher pain higher up', () => {
    const model = buildChartModel({
      readings: [
        { id: 'late', recordedAt: '2026-11-17T12:00:00Z', intensity: 1 },
        { id: 'early', recordedAt: '2026-11-17T08:00:00Z', intensity: 5 },
      ],
      start: d('2026-11-17T08:00:00Z'),
      end: d('2026-11-17T12:00:00Z'),
      now: d('2026-11-18T00:00:00Z'),
      timezone: 'UTC',
    });

    expect(model.points.map(p => p.id)).toEqual(['early', 'late']);
    expect(model.points[0]!.x).toBeCloseTo(CHART_PAD.left);
    expect(model.points[1]!.x).toBeCloseTo(CHART_WIDTH - CHART_PAD.right);
    expect(model.points[0]!.y).toBeLessThan(model.points[1]!.y);
    expect(model.spansMultipleDays).toBe(false);
    expect(model.levels).toHaveLength(5);
  });

  it('runs an ongoing attack up to now and marks each midnight', () => {
    const model = buildChartModel({
      readings: [{ id: 'a', recordedAt: '2026-11-16T22:00:00Z', intensity: 3 }],
      start: d('2026-11-16T21:00:00Z'),
      end: null,
      now: d('2026-11-18T09:00:00Z'),
      timezone: 'UTC',
    });

    expect(model.end.toISOString()).toBe('2026-11-18T09:00:00.000Z');
    expect(model.spansMultipleDays).toBe(true);
    expect(model.midnights.map(m => m.at.toISOString())).toEqual([
      '2026-11-17T00:00:00.000Z',
      '2026-11-18T00:00:00.000Z',
    ]);

    for (const m of model.midnights) {
      expect(m.x).toBeGreaterThan(CHART_PAD.left);
      expect(m.x).toBeLessThan(CHART_WIDTH - CHART_PAD.right);
    }
  });

  it('keeps readings on the chart when a device clock ran slightly ahead', () => {
    const model = buildChartModel({
      readings: [{ id: 'a', recordedAt: '2026-11-17T12:03:00Z', intensity: 2 }],
      start: d('2026-11-17T08:00:00Z'),
      end: null,
      now: d('2026-11-17T12:00:00Z'),
      timezone: 'UTC',
    });

    expect(model.points[0]!.x).toBeLessThanOrEqual(CHART_WIDTH - CHART_PAD.right + 0.001);
  });

  it('does not divide by zero for an attack logged a moment ago', () => {
    const t = d('2026-11-17T08:00:00Z');
    const model = buildChartModel({ readings: [{ id: 'a', recordedAt: t, intensity: 2 }], start: t, end: null, now: t, timezone: 'UTC' });

    expect(Number.isFinite(model.points[0]!.x)).toBe(true);
  });
});

describe('toDateTimeLocalValue', () => {
  it('formats in local time with minute precision', () => {
    const date = new Date(2026, 10, 7, 9, 5, 42);

    expect(toDateTimeLocalValue(date)).toBe('2026-11-07T09:05');
  });
});

describe('defaultReadingTime', () => {
  it('is now for an ongoing attack and the end for one that is over', () => {
    const now = d('2026-11-17T12:00:00Z');

    expect(defaultReadingTime(null, now)).toBe(now);
    expect(defaultReadingTime(d('2026-11-17T10:00:00Z'), now)).toEqual(d('2026-11-17T10:00:00Z'));
  });
});
