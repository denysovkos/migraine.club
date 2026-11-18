import type { PressureOutlookDay, PressurePoint } from './pressureOutlook';
import { and, eq } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { pressureForecastCacheSchema, userWeatherSettingsSchema } from '@/models/Schema';
import { openWeatherMapRepository } from '@/repositories/OpenWeatherMapRepository';

import { buildPressureOutlook, DEFAULT_HIGHLIGHT_THRESHOLD_HPA, isValidThreshold } from './pressureOutlook';

/** A cached forecast younger than this is served without calling the provider. */
export const PRESSURE_FORECAST_TTL_MS = 3 * 60 * 60 * 1000;

/** Same rounding as the daily weather snapshot cache (~1 km), so nearby users share a row. */
export function roundCoord(coord: number): number {
  return Math.round(coord * 100) / 100;
}

export type PressureAlertSettings = {
  userId: string;
  lat: number;
  lon: number;
  timezone: string;
  pressureDropThresholdHpa: number | null;
};

export type PressureOutlook = {
  timezone: string;
  /** User's alert threshold, null when alerts are off. */
  alertThresholdHpa: number | null;
  /** Threshold used to highlight drops (the alert threshold, or the default). */
  highlightThresholdHpa: number;
  days: PressureOutlookDay[];
};

export class PressureForecastService {
  /**
   * Daily pressure points for a location: fresh cache, else provider, else stale cache.
   */
  async getForecastPoints(lat: number, lon: number, nowUtc: Date = new Date()): Promise<PressurePoint[]> {
    const rLat = roundCoord(lat);
    const rLon = roundCoord(lon);

    const [cached] = await db
      .select()
      .from(pressureForecastCacheSchema)
      .where(and(eq(pressureForecastCacheSchema.lat, rLat), eq(pressureForecastCacheSchema.lon, rLon)))
      .limit(1);

    if (cached && nowUtc.getTime() - cached.fetchedAt.getTime() < PRESSURE_FORECAST_TTL_MS) {
      return cached.points;
    }

    const fresh = await openWeatherMapRepository.getDailyPressureForecast(rLat, rLon);
    if (fresh.length === 0) {
      return cached?.points ?? [];
    }

    try {
      await db
        .insert(pressureForecastCacheSchema)
        .values({ lat: rLat, lon: rLon, points: fresh, fetchedAt: nowUtc })
        .onConflictDoUpdate({
          target: [pressureForecastCacheSchema.lat, pressureForecastCacheSchema.lon],
          set: { points: fresh, fetchedAt: nowUtc },
        });
    } catch (error) {
      logger.warn({ error }, 'Failed to cache pressure forecast');
    }

    return fresh;
  }

  async getSettings(userId: string): Promise<PressureAlertSettings | null> {
    const [row] = await db
      .select({
        userId: userWeatherSettingsSchema.userId,
        lat: userWeatherSettingsSchema.lat,
        lon: userWeatherSettingsSchema.lon,
        timezone: userWeatherSettingsSchema.timezone,
        pressureDropThresholdHpa: userWeatherSettingsSchema.pressureDropThresholdHpa,
      })
      .from(userWeatherSettingsSchema)
      .where(eq(userWeatherSettingsSchema.userId, userId))
      .limit(1);

    return row ?? null;
  }

  /**
   * Returns false when the user has no location configured yet.
   */
  async setThreshold(userId: string, thresholdHpa: number | null): Promise<boolean> {
    if (thresholdHpa !== null && !isValidThreshold(thresholdHpa)) {
      throw new RangeError('Invalid pressure threshold');
    }

    const updated = await db
      .update(userWeatherSettingsSchema)
      .set({ pressureDropThresholdHpa: thresholdHpa })
      .where(eq(userWeatherSettingsSchema.userId, userId))
      .returning({ id: userWeatherSettingsSchema.id });

    return updated.length > 0;
  }

  async getOutlookForSettings(settings: PressureAlertSettings, nowUtc: Date = new Date()): Promise<PressureOutlook> {
    const points = await this.getForecastPoints(settings.lat, settings.lon, nowUtc);
    const highlight = settings.pressureDropThresholdHpa ?? DEFAULT_HIGHLIGHT_THRESHOLD_HPA;
    const todayLocal = DateTime.fromJSDate(nowUtc, { zone: settings.timezone }).toISODate()!;

    return {
      timezone: settings.timezone,
      alertThresholdHpa: settings.pressureDropThresholdHpa,
      highlightThresholdHpa: highlight,
      days: buildPressureOutlook(points, settings.timezone, highlight, todayLocal),
    };
  }
}

export const pressureForecastService = new PressureForecastService();
