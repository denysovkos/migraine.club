import type {
  IOpenWeatherMapData,
  SolarActivitySnapshot,
  UserWeatherSettings,
  WpiComponents,
  WpiHistoryPoint,
  WpiResult,
} from '@/types/WeatherPainIndex';

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
} from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  solarActivitySnapshotSchema,
  userWeatherSettingsSchema,
  weatherDailySnapshotSchema,
  weatherPainIndexSnapshotSchema,
} from '@/models/Schema';
import { openWeatherMapRepository } from '@/repositories/OpenWeatherMapRepository';
import { spaceWeatherKpRepository } from '@/repositories/SpaceWeatherKpRepository';

import { computeWpi } from './computeWpi';
import { shouldRecomputeWpiForKpChange } from './wpiSolarSync';

// How fresh a WPI snapshot needs to be to reuse (3 hours)
const WPI_FRESHNESS_MS = 3 * 60 * 60 * 1000;

export type ComputeWpiResult = {
  result: WpiResult;
  snapshotId: string;
  weather: IOpenWeatherMapData;
  kpIndex: number | null;
  solarSnapshot: SolarActivitySnapshot | null;
};

export class WeatherPainIndexService {
  private async getOrCreateAggregateSolarSnapshot(
    timestampUtc: Date,
    kpIndex: number,
  ): Promise<string | null> {
    const [existing] = await db
      .select({ id: solarActivitySnapshotSchema.id })
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          eq(solarActivitySnapshotSchema.source, 'kp_aggregate'),
          eq(solarActivitySnapshotSchema.timestampUtc, timestampUtc),
        ),
      )
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const [inserted] = await db
      .insert(solarActivitySnapshotSchema)
      .values({
        timestampUtc,
        kpIndex,
        source: 'kp_aggregate',
      })
      .onConflictDoNothing()
      .returning({ id: solarActivitySnapshotSchema.id });

    if (inserted) {
      return inserted.id;
    }

    const [afterConflict] = await db
      .select({ id: solarActivitySnapshotSchema.id })
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          eq(solarActivitySnapshotSchema.source, 'kp_aggregate'),
          eq(solarActivitySnapshotSchema.timestampUtc, timestampUtc),
        ),
      )
      .limit(1);

    return afterConflict?.id ?? null;
  }

  private async getClosestSolarSnapshot(
    timestampUtc: Date,
  ): Promise<{ kpIndex: number } | null> {
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const startTime = new Date(timestampUtc.getTime() - sixHoursMs);
    const endTime = new Date(timestampUtc.getTime() + sixHoursMs);

    const rows = await db
      .select({
        kpIndex: solarActivitySnapshotSchema.kpIndex,
        timestampUtc: solarActivitySnapshotSchema.timestampUtc,
      })
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          gte(solarActivitySnapshotSchema.timestampUtc, startTime),
          lte(solarActivitySnapshotSchema.timestampUtc, endTime),
          inArray(solarActivitySnapshotSchema.source, [
            'noaa',
            'noaa_now',
            'noaa_forecast',
            'gfz',
            'nasa',
            'kp_aggregate',
          ]),
        ),
      );

    if (rows.length === 0) {
      return null;
    }

    let closest = rows[0]!;
    let minDiff = Math.abs(timestampUtc.getTime() - closest.timestampUtc.getTime());
    for (const row of rows) {
      const diff = Math.abs(timestampUtc.getTime() - row.timestampUtc.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = row;
      }
    }

    return { kpIndex: closest.kpIndex };
  }

  /**
   * Get user weather settings
   */
  async getUserSettings(userId: string): Promise<UserWeatherSettings | null> {
    const [settings] = await db
      .select()
      .from(userWeatherSettingsSchema)
      .where(eq(userWeatherSettingsSchema.userId, userId))
      .limit(1);

    if (!settings) {
      return null;
    }

    return {
      id: settings.id,
      userId: settings.userId,
      lat: settings.lat,
      lon: settings.lon,
      locationLabel: settings.locationLabel,
      timezone: settings.timezone,
      units: settings.units,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /**
   * Update or create user weather settings
   */
  async upsertUserSettings(
    userId: string,
    settings: {
      lat: number;
      lon: number;
      locationLabel?: string | null;
      timezone?: string;
      units?: string;
    },
  ): Promise<UserWeatherSettings> {
    const [result] = await db
      .insert(userWeatherSettingsSchema)
      .values({
        userId,
        lat: settings.lat,
        lon: settings.lon,
        locationLabel: settings.locationLabel ?? null,
        timezone: settings.timezone ?? 'UTC',
        units: settings.units ?? 'metric',
      })
      .onConflictDoUpdate({
        target: userWeatherSettingsSchema.userId,
        set: {
          lat: settings.lat,
          lon: settings.lon,
          locationLabel: settings.locationLabel ?? null,
          timezone: settings.timezone ?? 'UTC',
          units: settings.units ?? 'metric',
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!result) {
      throw new Error('Failed to upsert user weather settings');
    }

    return {
      id: result.id,
      userId: result.userId,
      lat: result.lat,
      lon: result.lon,
      locationLabel: result.locationLabel,
      timezone: result.timezone,
      units: result.units,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Get the most recent WPI snapshot for a user if it's fresh enough
   */
  async getRecentSnapshot(userId: string): Promise<{
    snapshot: {
      id: string;
      wpiScore: number;
      wpiLevel: 'low' | 'moderate' | 'high' | 'very_high';
      components: WpiComponents;
      timestampLocal: Date;
      lat: number;
      lon: number;
    };
    weather: IOpenWeatherMapData | null;
    solar: SolarActivitySnapshot | null;
  } | null> {
    const [snapshot] = await db
      .select()
      .from(weatherPainIndexSnapshotSchema)
      .where(eq(weatherPainIndexSnapshotSchema.userId, userId))
      .orderBy(desc(weatherPainIndexSnapshotSchema.createdAt))
      .limit(1);

    if (!snapshot) {
      return null;
    }

    // Check freshness
    const now = new Date();
    if (now.getTime() - snapshot.createdAt.getTime() > WPI_FRESHNESS_MS) {
      return null;
    }

    // Fetch associated weather and solar data
    let weather: IOpenWeatherMapData | null = null;
    let solar: SolarActivitySnapshot | null = null;

    if (snapshot.weatherSnapshotId) {
      const [weatherSnapshot] = await db
        .select()
        .from(weatherDailySnapshotSchema)
        .where(eq(weatherDailySnapshotSchema.id, snapshot.weatherSnapshotId))
        .limit(1);

      if (weatherSnapshot) {
        weather = {
          deltaPressure: weatherSnapshot.deltaPressure,
          temperatureDeviation: weatherSnapshot.temperatureDeviation,
          humidity: weatherSnapshot.avgHumidity,
          windSpeed: weatherSnapshot.avgWindSpeed,
          uvi: weatherSnapshot.uvi,
        };
      }
    }

    if (snapshot.solarSnapshotId) {
      const [solarSnapshot] = await db
        .select()
        .from(solarActivitySnapshotSchema)
        .where(eq(solarActivitySnapshotSchema.id, snapshot.solarSnapshotId))
        .limit(1);

      if (solarSnapshot) {
        solar = {
          kpIndex: solarSnapshot.kpIndex,
          timestampUtc: solarSnapshot.timestampUtc,
          source: (solarSnapshot.source as SolarActivitySnapshot['source']) ?? 'noaa',
        };
      }
    }

    return {
      snapshot: {
        id: snapshot.id,
        wpiScore: snapshot.wpiScore,
        wpiLevel: snapshot.wpiLevel,
        components: snapshot.components,
        timestampLocal: snapshot.timestampLocal,
        lat: snapshot.lat,
        lon: snapshot.lon,
      },
      weather,
      solar,
    };
  }

  /**
   * Compute and store WPI for a user at a specific timestamp
   */
  async computeAndStoreForUser(
    userId: string,
    timestampLocal: Date,
  ): Promise<ComputeWpiResult> {
    // Get user settings
    const settings = await this.getUserSettings(userId);
    if (!settings) {
      throw new Error('User weather settings not found. Please configure your location first.');
    }

    const { lat, lon } = settings;

    // Get weather data
    const weatherResult = await openWeatherMapRepository.getAggregatedDaily(
      lat,
      lon,
      timestampLocal,
    );

    // Get solar data (DB-backed aggregate, synced by cron)
    const kpAgg = await spaceWeatherKpRepository.getAggregateFromDb();
    const avgKp = kpAgg.avgKp ?? null;

    // Compute WPI
    const wpiResult = computeWpi({
      deltaPressure: weatherResult.deltaPressure,
      temperatureDeviation: weatherResult.temperatureDeviation,
      humidity: weatherResult.humidity,
      windSpeed: weatherResult.windSpeed,
      uvi: weatherResult.uvi,
      kpIndex: avgKp,
    });

    // Link to an aggregate solar snapshot so history charts can render Kp.
    const solarSnapshotId: string | null = avgKp !== null
      ? await this.getOrCreateAggregateSolarSnapshot(kpAgg.computedAt, avgKp)
      : null;
    const solarSnapshot: SolarActivitySnapshot | null = avgKp !== null
      ? {
          kpIndex: avgKp,
          timestampUtc: kpAgg.computedAt,
          source: 'kp_aggregate',
        }
      : null;

    // Store WPI snapshot
    const [wpiSnapshot] = await db
      .insert(weatherPainIndexSnapshotSchema)
      .values({
        userId,
        timestampLocal,
        lat,
        lon,
        weatherSnapshotId: weatherResult.snapshotId,
        solarSnapshotId,
        wpiScore: wpiResult.score,
        wpiLevel: wpiResult.level,
        components: wpiResult.components,
      })
      .returning();

    if (!wpiSnapshot) {
      throw new Error('Failed to store WPI snapshot');
    }

    logger.info(
      { userId, wpiScore: wpiResult.score, wpiLevel: wpiResult.level },
      'Computed and stored WPI',
    );

    return {
      result: wpiResult,
      snapshotId: wpiSnapshot.id,
      weather: {
        deltaPressure: weatherResult.deltaPressure,
        temperatureDeviation: weatherResult.temperatureDeviation,
        humidity: weatherResult.humidity,
        windSpeed: weatherResult.windSpeed,
        uvi: weatherResult.uvi,
      },
      kpIndex: avgKp,
      solarSnapshot,
    };
  }

  /**
   * Get or compute current WPI for a user
   */
  async getCurrentWpi(userId: string): Promise<ComputeWpiResult> {
    // Try to get recent snapshot first
    const recent = await this.getRecentSnapshot(userId);
    if (recent) {
      // Ensure the displayed Kp (and the solar factor used in the score) stays in sync
      // with the current Solar activity (Kp) aggregate.
      const kpAgg = await spaceWeatherKpRepository.getAggregateFromDb();
      const currentAvgKp = kpAgg.avgKp ?? null;
      const recentKpForComparison = recent.solar?.kpIndex ?? currentAvgKp;

      if (shouldRecomputeWpiForKpChange({
        recentKp: recentKpForComparison,
        currentAvgKp,
      })) {
        return this.computeAndStoreForUser(userId, new Date());
      }

      const solarSnapshot: SolarActivitySnapshot | null = currentAvgKp !== null
        ? {
            kpIndex: currentAvgKp,
            timestampUtc: kpAgg.computedAt,
            source: 'kp_aggregate',
          }
        : recent.solar;

      return {
        result: {
          score: recent.snapshot.wpiScore,
          level: recent.snapshot.wpiLevel,
          components: recent.snapshot.components,
        },
        snapshotId: recent.snapshot.id,
        weather: recent.weather ?? {
          deltaPressure: 0,
          temperatureDeviation: 0,
          humidity: 50,
          windSpeed: 0,
          uvi: 0,
        },
        kpIndex: solarSnapshot?.kpIndex ?? null,
        solarSnapshot,
      };
    }

    // Compute fresh WPI
    return this.computeAndStoreForUser(userId, new Date());
  }

  /**
   * Get WPI history for a user over a number of days
   */
  async getHistory(userId: string, days: number = 14): Promise<WpiHistoryPoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshots = await db
      .select({
        timestamp: weatherPainIndexSnapshotSchema.timestampLocal,
        score: weatherPainIndexSnapshotSchema.wpiScore,
        level: weatherPainIndexSnapshotSchema.wpiLevel,
        solarSnapshotId: weatherPainIndexSnapshotSchema.solarSnapshotId,
      })
      .from(weatherPainIndexSnapshotSchema)
      .where(eq(weatherPainIndexSnapshotSchema.userId, userId))
      .orderBy(desc(weatherPainIndexSnapshotSchema.timestampLocal));

    // Return max 1 point per calendar day (latest snapshot of that day), capped to `days`.
    const points: WpiHistoryPoint[] = [];
    const seenDays = new Set<string>();

    for (const snapshot of snapshots) {
      if (snapshot.timestamp < startDate) {
        continue;
      }

      const dayKey = snapshot.timestamp.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
      if (seenDays.has(dayKey)) {
        continue;
      }
      seenDays.add(dayKey);

      let kpIndex: number | null = null;
      if (snapshot.solarSnapshotId) {
        const [solarRecord] = await db
          .select()
          .from(solarActivitySnapshotSchema)
          .where(eq(solarActivitySnapshotSchema.id, snapshot.solarSnapshotId))
          .limit(1);
        kpIndex = solarRecord?.kpIndex ?? null;
      } else {
        const closest = await this.getClosestSolarSnapshot(snapshot.timestamp);
        kpIndex = closest?.kpIndex ?? null;
      }

      points.push({
        timestamp: snapshot.timestamp.toISOString(),
        score: snapshot.score,
        level: snapshot.level,
        kpIndex,
      });

      if (points.length >= days) {
        break;
      }
    }

    return points;
  }
}

// Singleton instance
export const weatherPainIndexService = new WeatherPainIndexService();
