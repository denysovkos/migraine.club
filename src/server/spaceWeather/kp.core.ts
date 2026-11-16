export type KpProviderId = 'noaa' | 'gfz' | 'nasa';

export type KpReading = {
  provider: KpProviderId;
  value: number;
  timestamp: Date;
  stale: boolean;
  raw?: unknown;
  meta?: Record<string, any>;
};

export type KpAggregate = {
  avgKp: number | null;
  sourcesUsed: number;
  readings: KpReading[];
  computedAt: Date;
  minKp?: number;
  maxKp?: number;
  spread?: number;
  noaaScale?: string | null;
  lastStorm?: { startTime: Date; endTime: Date; peakKp: number; peakTime: Date };
  error?: string;
};

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function parseUtcTimestampAssumeZ(input: unknown): Date | null {
  if (typeof input !== 'string') {
    return null;
  }

  // If the timestamp has no timezone info, treat it as UTC (append "Z").
  // Examples:
  // - "2025-12-20T10:25:00" -> "2025-12-20T10:25:00Z"
  // - "2025-12-20 09:00:00" -> "2025-12-20T09:00:00Z"
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes(' ')
    ? trimmed.replace(' ', 'T')
    : trimmed;

  const hasTz = /(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const iso = hasTz ? normalized : `${normalized}Z`;

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isOlderThanMinutes(nowUtc: Date, tsUtc: Date, minutes: number): boolean {
  return nowUtc.getTime() - tsUtc.getTime() > minutes * 60 * 1000;
}

export function computeAggregateFromReadings(input: {
  computedAt: Date;
  readings: KpReading[];
  noaaScale?: string | null;
  lastStorm?: KpAggregate['lastStorm'];
}): KpAggregate {
  const used = input.readings.filter(r => !r.stale && Number.isFinite(r.value));
  const values = used.map(r => r.value);

  if (values.length === 0) {
    return {
      avgKp: null,
      sourcesUsed: 0,
      readings: input.readings,
      computedAt: input.computedAt,
      noaaScale: input.noaaScale ?? null,
      lastStorm: input.lastStorm,
      error: 'Kp not available',
    };
  }

  const minKp = Math.min(...values);
  const maxKp = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avgKp = sum / values.length;

  return {
    avgKp,
    sourcesUsed: values.length,
    readings: input.readings,
    computedAt: input.computedAt,
    minKp,
    maxKp,
    spread: maxKp - minKp,
    noaaScale: input.noaaScale ?? null,
    lastStorm: input.lastStorm,
  };
}

/**
 * NOAA – 1-minute estimated planetary Kp ("current")
 * https://services.swpc.noaa.gov/json/planetary_k_index_1m.json
 */
export function parseNoaa1mPlanetaryKp(
  data: unknown,
  nowUtc: Date,
): KpReading | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const last = data[data.length - 1] as any;
  const value = typeof last?.estimated_kp === 'number'
    ? last.estimated_kp
    : Number.parseFloat(String(last?.estimated_kp ?? ''));
  const ts = parseUtcTimestampAssumeZ(last?.time_tag);
  if (!Number.isFinite(value) || !ts) {
    return null;
  }
  const stale = isOlderThanMinutes(nowUtc, ts, 20);
  return {
    provider: 'noaa',
    value,
    timestamp: ts,
    stale,
    raw: last,
    meta: { sourceId: 'noaa_1m', kp_index: last?.kp_index },
  };
}

/**
 * NOAA – 3-hour observed/estimated/predicted series ("forecast" product)
 * https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json
 */
export function parseNoaaPlanetaryKIndexForecast(
  data: unknown,
  nowUtc: Date,
): { reading: KpReading | null; noaaScale: string | null } {
  if (!Array.isArray(data) || data.length < 2) {
    return { reading: null, noaaScale: null };
  }

  const header = data[0];
  if (!Array.isArray(header)) {
    return { reading: null, noaaScale: null };
  }

  const idx = {
    time_tag: header.indexOf('time_tag'),
    kp: header.indexOf('kp'),
    observed: header.indexOf('observed'),
    noaa_scale: header.indexOf('noaa_scale'),
  };

  if (idx.time_tag === -1 || idx.kp === -1 || idx.observed === -1) {
    return { reading: null, noaaScale: null };
  }

  let best: { ts: Date; value: number; noaaScale: string | null; raw: unknown } | null = null;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row)) {
      continue;
    }
    const observed = String(row[idx.observed] ?? '').toLowerCase();
    if (observed !== 'observed' && observed !== 'estimated') {
      continue;
    }

    const ts = parseUtcTimestampAssumeZ(row[idx.time_tag]);
    if (!ts || ts.getTime() > nowUtc.getTime()) {
      continue;
    }

    const value = Number.parseFloat(String(row[idx.kp] ?? ''));
    if (!Number.isFinite(value)) {
      continue;
    }

    const noaaScale = idx.noaa_scale >= 0 ? (row[idx.noaa_scale] != null ? String(row[idx.noaa_scale]) : null) : null;

    if (!best || ts.getTime() > best.ts.getTime()) {
      best = { ts, value, noaaScale, raw: row };
    }
  }

  if (!best) {
    return { reading: null, noaaScale: null };
  }

  const stale = isOlderThanMinutes(nowUtc, best.ts, 6 * 60);
  return {
    reading: {
      provider: 'noaa',
      value: best.value,
      timestamp: best.ts,
      stale,
      raw: best.raw,
      meta: { sourceId: 'noaa_forecast' },
    },
    noaaScale: best.noaaScale,
  };
}

/**
 * GFZ – official webservice Kp
 * https://kp.gfz.de/app/json/?start=...&end=...&index=Kp
 */
export function parseGfzWebserviceKp(
  data: unknown,
  nowUtc: Date,
): KpReading | null {
  const obj = data as any;
  const datetimes = obj?.datetime;
  const kps = obj?.Kp;
  const status = obj?.status;
  if (!Array.isArray(datetimes) || !Array.isArray(kps)) {
    return null;
  }
  if (datetimes.length === 0 || kps.length === 0 || datetimes.length !== kps.length) {
    return null;
  }

  let bestIdx: number | null = null;
  for (let i = 0; i < datetimes.length; i++) {
    const ts = parseUtcTimestampAssumeZ(datetimes[i]);
    if (!ts || ts.getTime() > nowUtc.getTime()) {
      continue;
    }
    const value = kps[i];
    if (!Number.isFinite(value)) {
      continue;
    }
    if (bestIdx === null || ts.getTime() > parseUtcTimestampAssumeZ(datetimes[bestIdx])!.getTime()) {
      bestIdx = i;
    }
  }

  if (bestIdx === null) {
    return null;
  }

  const ts = parseUtcTimestampAssumeZ(datetimes[bestIdx]);
  const value = kps[bestIdx];
  if (!ts || !Number.isFinite(value)) {
    return null;
  }

  const stale = isOlderThanMinutes(nowUtc, ts, 6 * 60);
  return {
    provider: 'gfz',
    value,
    timestamp: ts,
    stale,
    raw: data,
    meta: {
      sourceId: 'gfz_webservice',
      status: Array.isArray(status) ? status[bestIdx] : undefined,
      meta: obj?.meta,
    },
  };
}

/**
 * GFZ – website JSON nowcast fallback
 * https://kp.gfz.de/app/json/kpnowcast.json
 */
export function parseGfzNowcastKp(
  data: unknown,
  nowUtc: Date,
): KpReading | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const last = data[data.length - 1] as any;
  if (!Array.isArray(last) || last.length < 2) {
    return null;
  }
  const ts = new Date(Number(last[0]));
  const value = typeof last[1] === 'number' ? last[1] : Number.parseFloat(String(last[1] ?? ''));
  if (Number.isNaN(ts.getTime()) || !Number.isFinite(value)) {
    return null;
  }
  const stale = isOlderThanMinutes(nowUtc, ts, 6 * 60);
  return {
    provider: 'gfz',
    value,
    timestamp: ts,
    stale,
    raw: last,
    meta: { sourceId: 'gfz_nowcast' },
  };
}

/**
 * GFZ – last storm info (not part of avg)
 * https://kp.gfz.de/app/json/laststorm.json
 */
export function parseGfzLastStorm(
  data: unknown,
): KpAggregate['lastStorm'] | undefined {
  if (!Array.isArray(data) || data.length < 2) {
    return undefined;
  }
  const pairs = data
    .filter((x): x is [number, number] => Array.isArray(x) && x.length >= 2)
    .map(x => [Number((x as any)[0]), Number((x as any)[1])] as [number, number])
    .filter(([t, kp]) => Number.isFinite(t) && Number.isFinite(kp));

  if (pairs.length < 2) {
    return undefined;
  }

  const first = pairs[0];
  const last = pairs.at(-1);
  if (!first || !last) {
    return undefined;
  }

  const startTime = new Date(first[0]);
  const endTime = new Date(last[0]);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return undefined;
  }

  let peakKp = -Infinity;
  let peakTime = startTime;
  for (const [t, kp] of pairs) {
    if (kp > peakKp) {
      peakKp = kp;
      peakTime = new Date(t);
    }
  }
  if (!Number.isFinite(peakKp) || Number.isNaN(peakTime.getTime())) {
    return undefined;
  }

  return { startTime, endTime, peakKp, peakTime };
}

/**
 * NASA DONKI – Geomagnetic Storms (GST)
 * https://api.nasa.gov/DONKI/GST
 */
export function parseNasaDonkiGst(
  data: unknown,
  nowUtc: Date,
): KpReading | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  let best: { ts: Date; value: number; source?: string; raw: unknown } | null = null;

  for (const storm of data as any[]) {
    const all = storm?.allKpIndex;
    if (!Array.isArray(all)) {
      continue;
    }
    for (const entry of all as any[]) {
      const ts = parseUtcTimestampAssumeZ(entry?.observedTime);
      if (!ts || ts.getTime() > nowUtc.getTime()) {
        continue;
      }
      const value = typeof entry?.kpIndex === 'number'
        ? entry.kpIndex
        : Number.parseFloat(String(entry?.kpIndex ?? ''));
      if (!Number.isFinite(value)) {
        continue;
      }

      if (!best || ts.getTime() > best.ts.getTime()) {
        best = { ts, value, source: entry?.source, raw: { storm, entry } };
      }
    }
  }

  if (!best) {
    return null;
  }

  const stale = isOlderThanMinutes(nowUtc, best.ts, 24 * 60);
  return {
    provider: 'nasa',
    value: best.value,
    timestamp: best.ts,
    stale,
    raw: best.raw,
    meta: { sourceId: 'nasa_donki_gst', entrySource: best.source },
  };
}
