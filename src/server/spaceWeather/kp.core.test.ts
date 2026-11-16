import type { KpReading } from './kp.core';

import { describe, expect, it } from 'vitest';
import gfzLastStorm from '../../../tests/fixtures/kp/gfz_laststorm.json';
import gfzNowcast from '../../../tests/fixtures/kp/gfz_nowcast.json';
import gfzWebservice from '../../../tests/fixtures/kp/gfz_webservice.json';
import gfzWebserviceBad from '../../../tests/fixtures/kp/gfz_webservice_bad.json';
import nasaGst from '../../../tests/fixtures/kp/nasa_donki_gst.json';
import noaa1m from '../../../tests/fixtures/kp/noaa_1m.json';
import noaaForecast from '../../../tests/fixtures/kp/noaa_forecast.json';
import {
  computeAggregateFromReadings,
  parseGfzLastStorm,
  parseGfzNowcastKp,
  parseGfzWebserviceKp,
  parseNasaDonkiGst,
  parseNoaa1mPlanetaryKp,
  parseNoaaPlanetaryKIndexForecast,
} from './kp.core';

describe('Kp parsers', () => {
  it('parses NOAA 1m last element and assumes UTC when timezone is missing', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const r = parseNoaa1mPlanetaryKp(noaa1m as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.provider).toBe('noaa');
    expect(r!.value).toBeCloseTo(2.75, 10);
    expect(r!.timestamp.toISOString()).toBe('2025-12-20T10:25:00.000Z');
    expect(r!.stale).toBe(false);
  });

  it('marks NOAA 1m as stale after 20 minutes', () => {
    const nowUtc = new Date('2025-12-20T10:50:01Z');
    const r = parseNoaa1mPlanetaryKp(noaa1m as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.stale).toBe(true);
  });

  it('parses NOAA forecast and selects latest observed/estimated row <= now', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const { reading, noaaScale } = parseNoaaPlanetaryKIndexForecast(noaaForecast as any, nowUtc);

    expect(reading).not.toBeNull();
    expect(reading!.provider).toBe('noaa');
    expect(reading!.value).toBeCloseTo(4.33, 10);
    expect(reading!.timestamp.toISOString()).toBe('2025-12-20T09:00:00.000Z');
    expect(reading!.stale).toBe(false);
    expect(noaaScale).toBe('G0');
  });

  it('parses GFZ webservice and returns null on array mismatch', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');

    expect(parseGfzWebserviceKp(gfzWebserviceBad as any, nowUtc)).toBeNull();
  });

  it('parses GFZ webservice last Kp <= now and applies 6h staleness', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const r = parseGfzWebserviceKp(gfzWebservice as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.provider).toBe('gfz');
    expect(r!.value).toBeCloseTo(4, 10);
    expect(r!.timestamp.toISOString()).toBe('2025-12-20T06:00:00.000Z');
    expect(r!.stale).toBe(false);
  });

  it('parses GFZ nowcast last pair', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const r = parseGfzNowcastKp(gfzNowcast as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.provider).toBe('gfz');
    expect(r!.value).toBeCloseTo(3.0, 10);
  });

  it('parses GFZ last storm peak', () => {
    const info = parseGfzLastStorm(gfzLastStorm as any);

    expect(info).toBeTruthy();
    expect(info!.peakKp).toBe(5);
    expect(info!.startTime.toISOString()).toBe(new Date(1734566400000).toISOString());
    expect(info!.endTime.toISOString()).toBe(new Date(1734588000000).toISOString());
  });

  it('parses NASA DONKI GST and uses most recent observedTime', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const r = parseNasaDonkiGst(nasaGst as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.provider).toBe('nasa');
    expect(r!.value).toBe(6);
    expect(r!.timestamp.toISOString()).toBe('2025-12-20T09:30:00.000Z');
    expect(r!.stale).toBe(false);
  });

  it('marks NASA DONKI GST reading stale when older than 24h (ignored by aggregate)', () => {
    const nowUtc = new Date('2025-12-21T12:00:00Z');
    const r = parseNasaDonkiGst(nasaGst as any, nowUtc);

    expect(r).not.toBeNull();
    expect(r!.stale).toBe(true);
  });
});

describe('Kp aggregation rules', () => {
  it('excludes missing and stale readings (does not default missing to 0)', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const readings: KpReading[] = [
      {
        provider: 'noaa',
        value: 4,
        timestamp: nowUtc,
        stale: false,
      },
      {
        provider: 'gfz',
        value: 7,
        timestamp: new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000),
        stale: true,
      },
    ];

    const agg = computeAggregateFromReadings({ computedAt: nowUtc, readings });

    expect(agg.sourcesUsed).toBe(1);
    expect(agg.avgKp).toBe(4);
    expect(agg.minKp).toBe(4);
    expect(agg.maxKp).toBe(4);
    expect(agg.spread).toBe(0);
  });

  it('includes actual Kp=0 values in the average', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const readings: KpReading[] = [
      { provider: 'noaa', value: 0, timestamp: nowUtc, stale: false },
      { provider: 'gfz', value: 2, timestamp: nowUtc, stale: false },
    ];
    const agg = computeAggregateFromReadings({ computedAt: nowUtc, readings });

    expect(agg.sourcesUsed).toBe(2);
    expect(agg.avgKp).toBe(1);
  });

  it('returns avgKp=null and error when no usable readings exist', () => {
    const nowUtc = new Date('2025-12-20T10:30:00Z');
    const readings: KpReading[] = [
      { provider: 'noaa', value: 3, timestamp: nowUtc, stale: true },
    ];
    const agg = computeAggregateFromReadings({ computedAt: nowUtc, readings });

    expect(agg.sourcesUsed).toBe(0);
    expect(agg.avgKp).toBeNull();
    expect(agg.error).toBe('Kp not available');
  });
});
