import type { KpAggregate, KpReading } from '@/server/spaceWeather/kp.core';

import { desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { solarActivitySnapshotSchema } from '@/models/Schema';
import {
  computeAggregateFromReadings,
  isOlderThanMinutes,
  parseGfzLastStorm,
  parseGfzNowcastKp,
  parseGfzWebserviceKp,
  parseNasaDonkiGst,
  parseNoaa1mPlanetaryKp,
  parseNoaaPlanetaryKIndexForecast,
} from '@/server/spaceWeather/kp.core';

type SnapshotRow = {
  id: string;
  timestampUtc: Date;
  kpIndex: number;
  source: string;
  raw: Record<string, unknown> | null;
  createdAt: Date;
};

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
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

function pickLatestCreatedAt(rows: Array<SnapshotRow | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    if (!r) {
      continue;
    }
    if (!best || r.createdAt.getTime() > best.getTime()) {
      best = r.createdAt;
    }
  }
  return best;
}

function rowToReading(row: SnapshotRow, nowUtc: Date): KpReading {
  const raw = row.raw ?? undefined;
  const rawMeta = (raw && typeof raw === 'object' ? (raw as any).meta : undefined) as Record<string, any> | undefined;
  const rawPayload = (raw && typeof raw === 'object' ? (raw as any).raw : undefined) as unknown;
  const provider = row.source === 'gfz' ? 'gfz' : row.source === 'nasa' ? 'nasa' : 'noaa';

  // staleness based on the *provider* (NOAA varies by source id below)
  let stale = false;
  if (row.source === 'noaa_now') {
    stale = isOlderThanMinutes(nowUtc, row.timestampUtc, 20);
  } else if (row.source === 'noaa_forecast') {
    stale = isOlderThanMinutes(nowUtc, row.timestampUtc, 6 * 60);
  } else if (row.source === 'gfz') {
    stale = isOlderThanMinutes(nowUtc, row.timestampUtc, 6 * 60);
  } else if (row.source === 'nasa') {
    stale = isOlderThanMinutes(nowUtc, row.timestampUtc, 24 * 60);
  }

  return {
    provider,
    value: row.kpIndex,
    timestamp: row.timestampUtc,
    stale,
    raw: rawPayload ?? raw,
    meta: rawMeta ?? (raw ? { sourceId: row.source } : { sourceId: row.source }),
  };
}

function rowToLastStorm(row: SnapshotRow): KpAggregate['lastStorm'] | undefined {
  const raw = row.raw as any;
  const ls = raw?.lastStorm;
  if (!ls) {
    return undefined;
  }
  const startTime = new Date(ls.startTime);
  const endTime = new Date(ls.endTime);
  const peakTime = new Date(ls.peakTime);
  const peakKp = Number(ls.peakKp);
  if (
    Number.isNaN(startTime.getTime())
    || Number.isNaN(endTime.getTime())
    || Number.isNaN(peakTime.getTime())
    || !Number.isFinite(peakKp)
  ) {
    return undefined;
  }
  return { startTime, endTime, peakKp, peakTime };
}

export class SpaceWeatherKpRepository {
  /**
   * Sync "current" Kp from multiple sources into DB.
   * This avoids per-request upstream calls in the public API.
   */
  async syncFromSources(nowUtc: Date = new Date()): Promise<{
    inserted: number;
    insertedBySource: Record<string, number>;
  }> {
    const insertedBySource: Record<string, number> = {};

    const start48h = new Date(nowUtc.getTime() - 48 * 60 * 60 * 1000);
    const end48h = new Date(nowUtc.getTime() + 48 * 60 * 60 * 1000);
    const nasaKey = process.env.NASA_API_KEY;
    const start30d = new Date(nowUtc.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch concurrently; fall back within each provider where needed.
    const [noaaRes, gfzRes, nasaRes, lastStormRes] = await Promise.allSettled([
      (async () => {
        // NOAA preferred: 1-minute now
        try {
          const data = await fetchJson('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', 4000);
          const r = parseNoaa1mPlanetaryKp(data, nowUtc);
          if (r && !r.stale) {
            return { reading: r, source: 'noaa_now', extra: null as null | { noaaScale: string | null } };
          }
        } catch {
          // ignore
        }

        // NOAA fallback: 3-hour observed/estimated from forecast product
        try {
          const data = await fetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', 5000);
          const parsed = parseNoaaPlanetaryKIndexForecast(data, nowUtc);
          if (parsed.reading && !parsed.reading.stale) {
            // store scale alongside
            return { reading: parsed.reading, source: 'noaa_forecast', extra: { noaaScale: parsed.noaaScale } };
          }
        } catch {
          // ignore
        }

        return { reading: null, source: null, extra: null };
      })(),
      (async () => {
        // GFZ preferred: webservice 48h
        try {
          // Intentionally query into the future so we can persist forecast datapoints in `raw`.
          // This powers "upcoming storm" alerts without extra upstream calls at alert time.
          const url = `https://kp.gfz.de/app/json/?start=${encodeURIComponent(toIsoSecondsUtc(start48h))}&end=${encodeURIComponent(toIsoSecondsUtc(end48h))}&index=Kp`;
          const data = await fetchJson(url, 5000);
          const r = parseGfzWebserviceKp(data, nowUtc);
          if (r && !r.stale) {
            return r;
          }
        } catch {
          // ignore
        }

        // GFZ fallback: nowcast
        try {
          const data = await fetchJson('https://kp.gfz.de/app/json/kpnowcast.json', 4000);
          const r = parseGfzNowcastKp(data, nowUtc);
          if (r && !r.stale) {
            return r;
          }
        } catch {
          // ignore
        }
        return null;
      })(),
      (async () => {
        if (!nasaKey) {
          return null;
        }
        try {
          const url = `https://api.nasa.gov/DONKI/GST?startDate=${encodeURIComponent(ymdUtc(start30d))}&endDate=${encodeURIComponent(ymdUtc(nowUtc))}&api_key=${encodeURIComponent(nasaKey)}`;
          const data = await fetchJson(url, 5000);
          const r = parseNasaDonkiGst(data, nowUtc);
          // event-based; still store even if stale, but it won't be used in avg
          return r;
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const data = await fetchJson('https://kp.gfz.de/app/json/laststorm.json', 5000);
          return parseGfzLastStorm(data);
        } catch {
          return undefined;
        }
      })(),
    ]);

    const settledSummary = <T>(label: string, res: PromiseSettledResult<T>) => {
      if (res.status === 'fulfilled') {
        logger.info({ label, ok: true }, 'SpaceWeather provider response');
      } else {
        logger.warn({ label, ok: false, error: res.reason }, 'SpaceWeather provider response');
      }
    };

    settledSummary('noaa', noaaRes);
    settledSummary('gfz', gfzRes);
    settledSummary('nasa', nasaRes);
    settledSummary('gfz_laststorm', lastStormRes);

    if (noaaRes.status === 'fulfilled') {
      logger.info(
        {
          label: 'noaa',
          hasReading: Boolean(noaaRes.value.reading),
          source: noaaRes.value.source,
          stale: noaaRes.value.reading?.stale ?? null,
        },
        'SpaceWeather NOAA parsed result',
      );
    }
    if (gfzRes.status === 'fulfilled') {
      logger.info(
        {
          label: 'gfz',
          hasReading: Boolean(gfzRes.value),
          stale: gfzRes.value?.stale ?? null,
        },
        'SpaceWeather GFZ parsed result',
      );
    }
    if (nasaRes.status === 'fulfilled') {
      logger.info(
        {
          label: 'nasa',
          hasReading: Boolean(nasaRes.value),
          stale: nasaRes.value?.stale ?? null,
        },
        'SpaceWeather NASA parsed result',
      );
    }

    // Insert snapshots (ignore conflicts)
    const insertOne = async (args: {
      source: string;
      timestampUtc: Date;
      kpIndex: number;
      raw?: Record<string, unknown>;
    }) => {
      const res = await db
        .insert(solarActivitySnapshotSchema)
        .values({
          timestampUtc: args.timestampUtc,
          kpIndex: args.kpIndex,
          source: args.source,
          raw: args.raw,
        })
        .onConflictDoNothing()
        .returning({ id: solarActivitySnapshotSchema.id });

      const didInsert = res.length > 0;
      if (didInsert) {
        insertedBySource[args.source] = (insertedBySource[args.source] ?? 0) + 1;
      }
      return didInsert;
    };

    let inserted = 0;

    if (noaaRes.status === 'fulfilled' && noaaRes.value.reading && noaaRes.value.source) {
      const r = noaaRes.value.reading;
      const source = noaaRes.value.source;
      const extra = noaaRes.value.extra;
      const didInsert = await insertOne({
        source,
        timestampUtc: r.timestamp,
        kpIndex: r.value,
        raw: {
          fetchedAt: nowUtc.toISOString(),
          meta: {
            ...(r.meta ?? {}),
            sourceId: r.meta?.sourceId ?? (r.meta?.sourceId === '' ? r.meta.sourceId : source),
            noaaScale: extra?.noaaScale ?? null,
          },
          raw: r.raw ?? null,
        },
      });
      if (didInsert) {
        inserted++;
      }
    }

    if (gfzRes.status === 'fulfilled' && gfzRes.value) {
      const r = gfzRes.value;
      const didInsert = await insertOne({
        source: 'gfz',
        timestampUtc: r.timestamp,
        kpIndex: r.value,
        raw: {
          fetchedAt: nowUtc.toISOString(),
          meta: { ...(r.meta ?? {}), sourceId: r.meta?.sourceId ?? 'gfz' },
          raw: r.raw ?? null,
        },
      });
      if (didInsert) {
        inserted++;
      }
    }

    if (nasaRes.status === 'fulfilled' && nasaRes.value) {
      const r = nasaRes.value;
      const didInsert = await insertOne({
        source: 'nasa',
        timestampUtc: r.timestamp,
        kpIndex: r.value,
        raw: {
          fetchedAt: nowUtc.toISOString(),
          meta: { ...(r.meta ?? {}), sourceId: r.meta?.sourceId ?? 'nasa_donki_gst' },
          raw: r.raw ?? null,
        },
      });
      if (didInsert) {
        inserted++;
      }
    }

    if (lastStormRes.status === 'fulfilled' && lastStormRes.value) {
      const ls = lastStormRes.value;
      // Store as a special snapshot row; not part of avg.
      const didInsert = await insertOne({
        source: 'gfz_laststorm',
        timestampUtc: ls.peakTime,
        kpIndex: ls.peakKp,
        raw: {
          fetchedAt: nowUtc.toISOString(),
          lastStorm: {
            startTime: ls.startTime.toISOString(),
            endTime: ls.endTime.toISOString(),
            peakKp: ls.peakKp,
            peakTime: ls.peakTime.toISOString(),
          },
        },
      });
      if (didInsert) {
        inserted++;
      }
    }

    logger.info({ inserted, insertedBySource }, 'SpaceWeather Kp sync completed');
    return { inserted, insertedBySource };
  }

  async getLatestBySource(source: string): Promise<SnapshotRow | null> {
    const [row] = await db
      .select()
      .from(solarActivitySnapshotSchema)
      .where(eq(solarActivitySnapshotSchema.source, source))
      .orderBy(desc(solarActivitySnapshotSchema.timestampUtc))
      .limit(1);

    return (row as SnapshotRow | undefined) ?? null;
  }

  /**
   * Build the Kp aggregate purely from DB rows.
   * (No upstream calls here.)
   */
  async getAggregateFromDb(nowUtc: Date = new Date()): Promise<KpAggregate> {
    const [noaaNow, noaaForecast, gfz, nasa, lastStorm] = await Promise.all([
      this.getLatestBySource('noaa_now'),
      this.getLatestBySource('noaa_forecast'),
      this.getLatestBySource('gfz'),
      this.getLatestBySource('nasa'),
      this.getLatestBySource('gfz_laststorm'),
    ]);

    // NOAA: prefer now if fresh, otherwise fallback to forecast if fresh.
    const noaaNowReading = noaaNow ? rowToReading(noaaNow, nowUtc) : null;
    const noaaForecastReading = noaaForecast ? rowToReading(noaaForecast, nowUtc) : null;

    const chosenNoaa = (noaaNowReading && !noaaNowReading.stale)
      ? noaaNowReading
      : (noaaForecastReading && !noaaForecastReading.stale)
          ? noaaForecastReading
          : (noaaNowReading ?? noaaForecastReading);

    const readings: KpReading[] = [];
    if (chosenNoaa) {
      readings.push(chosenNoaa);
    }
    if (gfz) {
      readings.push(rowToReading(gfz, nowUtc));
    }
    if (nasa) {
      readings.push(rowToReading(nasa, nowUtc));
    }

    const noaaScale = (() => {
      if (!noaaForecast) {
        return null;
      }
      const raw = noaaForecast.raw as any;
      return raw?.meta?.noaaScale ?? null;
    })();

    const computedAt = pickLatestCreatedAt([noaaNow, noaaForecast, gfz, nasa, lastStorm]) ?? nowUtc;
    const agg = computeAggregateFromReadings({
      computedAt,
      readings,
      noaaScale,
      lastStorm: lastStorm ? rowToLastStorm(lastStorm) : undefined,
    });

    // If all readings we found are stale, computeAggregateFromReadings will return Kp not available.
    // That’s expected and prevents showing "0" from missing data.
    return agg;
  }
}

export const spaceWeatherKpRepository = new SpaceWeatherKpRepository();
