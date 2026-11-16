import type { KpAggregate, KpReading } from './kp.core';
import {
  computeAggregateFromReadings,

  parseGfzLastStorm,
  parseGfzNowcastKp,
  parseGfzWebserviceKp,
  parseNasaDonkiGst,
  parseNoaa1mPlanetaryKp,
  parseNoaaPlanetaryKIndexForecast,
} from './kp.core';

import 'server-only';

function toIsoSecondsUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
    // These are public endpoints; we still keep per-request caching disabled here
    // because we do our own 60s memoization below.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function getNoaaReading(nowUtc: Date): Promise<{ reading: KpReading | null; noaaScale: string | null }> {
  // Preferred: 1-minute "current"
  try {
    const data = await fetchJson(
      'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
      4000,
    );
    const reading = parseNoaa1mPlanetaryKp(data, nowUtc);
    if (reading && !reading.stale) {
      return { reading, noaaScale: null };
    }
  } catch {
    // ignore, fallback below
  }

  // Fallback: 3-hour observed/estimated series
  try {
    const data = await fetchJson(
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
      5000,
    );
    return parseNoaaPlanetaryKIndexForecast(data, nowUtc);
  } catch {
    return { reading: null, noaaScale: null };
  }
}

async function getGfzReading(nowUtc: Date): Promise<KpReading | null> {
  // Preferred: webservice query over the last 48h
  try {
    const start = new Date(nowUtc.getTime() - 48 * 60 * 60 * 1000);
    const url = `https://kp.gfz.de/app/json/?start=${encodeURIComponent(toIsoSecondsUtc(start))}&end=${encodeURIComponent(toIsoSecondsUtc(nowUtc))}&index=Kp`;
    const data = await fetchJson(url, 5000);
    const reading = parseGfzWebserviceKp(data, nowUtc);
    if (reading) {
      return reading;
    }
  } catch {
    // ignore, fallback below
  }

  // Fallback: nowcast JSON
  try {
    const data = await fetchJson('https://kp.gfz.de/app/json/kpnowcast.json', 4000);
    return parseGfzNowcastKp(data, nowUtc);
  } catch {
    return null;
  }
}

async function getGfzLastStorm(): Promise<KpAggregate['lastStorm'] | undefined> {
  // Informational only
  try {
    const data = await fetchJson('https://kp.gfz.de/app/json/laststorm.json', 5000);
    // Optionally: we could ignore *very* old last storms, but spec doesn't ask for it.
    return parseGfzLastStorm(data);
  } catch {
    return undefined;
  }
}

async function getNasaReading(nowUtc: Date): Promise<KpReading | null> {
  const apiKey = process.env.NASA_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const start = new Date(nowUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
    const url = `https://api.nasa.gov/DONKI/GST?startDate=${encodeURIComponent(ymdUtc(start))}&endDate=${encodeURIComponent(ymdUtc(nowUtc))}&api_key=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url, 5000);
    const reading = parseNasaDonkiGst(data, nowUtc);
    // NASA is event-based; if stale, treat as absent for avg, but we still return it in breakdown.
    return reading;
  } catch {
    return null;
  }
}

async function getKpAggregateUncached(): Promise<KpAggregate> {
  const nowUtc = new Date();

  const [noaaRes, gfzRes, nasaRes, lastStormRes] = await Promise.allSettled([
    getNoaaReading(nowUtc),
    getGfzReading(nowUtc),
    getNasaReading(nowUtc),
    getGfzLastStorm(),
  ]);

  const readings: KpReading[] = [];
  let noaaScale: string | null = null;
  let lastStorm: KpAggregate['lastStorm'] | undefined;

  if (noaaRes.status === 'fulfilled') {
    if (noaaRes.value.reading) {
      readings.push(noaaRes.value.reading);
    }
    noaaScale = noaaRes.value.noaaScale;
  }

  if (gfzRes.status === 'fulfilled' && gfzRes.value) {
    readings.push(gfzRes.value);
  }

  if (nasaRes.status === 'fulfilled' && nasaRes.value) {
    readings.push(nasaRes.value);
  }

  if (lastStormRes.status === 'fulfilled') {
    lastStorm = lastStormRes.value;
  }

  // Only 1 reading per provider should be present; enforce defensively.
  const byProvider = new Map<string, KpReading>();
  for (const r of readings) {
    if (!byProvider.has(r.provider)) {
      byProvider.set(r.provider, r);
    }
  }

  return computeAggregateFromReadings({
    computedAt: nowUtc,
    readings: [...byProvider.values()],
    noaaScale,
    lastStorm,
  });
}

let memo: { expiresAtMs: number; value: KpAggregate } | null = null;
let inflight: Promise<KpAggregate> | null = null;

/**
 * Cached for ~60s (best-effort, per-runtime instance).
 */
export async function getKpAggregate(): Promise<KpAggregate> {
  const now = Date.now();
  if (memo && now < memo.expiresAtMs) {
    return memo.value;
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const value = await getKpAggregateUncached();
      memo = { value, expiresAtMs: Date.now() + 60_000 };
      return value;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
