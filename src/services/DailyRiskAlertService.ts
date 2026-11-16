import type { Deadline } from '@/libs/asyncLimits';
import type { SupportedLanguageType } from '@/models/Schema';
import { and, desc, eq, sql } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { mapWithConcurrency, withTimeout } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { getServerTranslator } from '@/libs/i18nMessages';
import { logger } from '@/libs/Logger';
import {
  riskAlertRunSchema,
  RiskAlertStatus,
  RiskAlertType,
  solarActivitySnapshotSchema,
  userSchema,
  userWeatherSettingsSchema,
} from '@/models/Schema';
import { spaceWeatherKpRepository } from '@/repositories/SpaceWeatherKpRepository';
import { pushService } from '@/server/push/push.service';

import { weatherPainIndexService } from './WeatherPainIndexService';

// WPI thresholds (scale 0-10)
// "high" is >= 5.0, "very_high" is >= 7.5
const WPI_HIGH_THRESHOLD = 5.0;

// Solar/Kp thresholds
// Kp >= 5 is considered "storm" level (G1 minor storm)
// Kp >= 6 is "G2 moderate storm"
const KP_STORM_THRESHOLD = 5;

export type SolarForecast = {
  kpIndex: number;
  timestampUtc: Date;
  source: 'gfz';
};

// Processing limits
const MAX_USERS_PER_RUN = 2000;
// Per-user work is a DB read plus an OpenWeatherMap call plus a push send, so the
// ceiling is whichever of the pg pool or the upstream rate limit we hit first: 8.
const USER_CONCURRENCY = 8;
// Best-effort refresh: if the upstream sources stall we would burn the whole run
// waiting on them, so cap it and fall back to whatever is already in the DB.
const SPACE_WEATHER_SYNC_TIMEOUT_MS = 15_000;

/**
 * Result of processing a single user
 */
export type UserAlertResult = {
  userId: string;
  status: 'sent' | 'skipped' | 'failed' | 'already_processed';
  wpiScore?: number;
  wpiLevel?: string;
  solarForecastKp?: number | null;
  solarForecastTimestampUtc?: string | null;
  wpiHigh?: boolean;
  solarHigh?: boolean;
  error?: string;
};

/**
 * Result of processing daily risk alerts
 */
export type DailyRiskAlertResult = {
  eligibleTimezones: string[];
  usersProcessed: number;
  sent: number;
  skipped: number;
  failed: number;
  alreadyProcessed: number;
  truncated: boolean;
  /** Users never started because the time budget ran out; the next tick picks them up. */
  remaining: number;
  results: UserAlertResult[];
};

/**
 * User weather settings with required fields
 */
type UserSettings = {
  userId: string;
  lat: number;
  lon: number;
  timezone: string;
  preferredLanguage: SupportedLanguageType;
};

/**
 * Returns true if local time is in allowed window: 09:00–19:59 (dt's zone).
 */
export function isNotBetween8pmAnd9am(dt: DateTime): boolean {
  const h = dt.hour; // 0..23 in dt's zone
  const inQuietHours = h >= 20 || h < 9; // 20:00–08:59
  return !inQuietHours; // 09:00–19:59
}

/**
 * Get the local date string (YYYY-MM-DD) for a timezone
 */
export function getLocalDateString(timezone: string, nowUtc: Date): string {
  const localTime = DateTime.fromJSDate(nowUtc, { zone: timezone });
  return localTime.toISODate() ?? DateTime.fromJSDate(nowUtc).toISODate()!;
}

/**
 * DailyRiskAlertService - Handles risk alert processing (runs every 4 hours)
 */
export class DailyRiskAlertService {
  /**
   * Process risk alerts for all users with alerts enabled.
   * Called by cron job every 4 hours.
   *
   * Logic:
   * - load fresh solar data (GFZ/NOAA/NASA) into DB
   * - for each alert-enabled user:
   *   - gate by local time window 09:00–19:59
   *   - compute WPI (same codepath as the widget)
   *   - compute upcoming solar storm by taking max future Kp from GFZ raw
   *   - send a grouped notification if WPI>=5 and/or future max Kp>=5
   */
  async processAlerts(nowUtc: Date = new Date(), deadline?: Deadline): Promise<DailyRiskAlertResult> {
    const startTime = Date.now();

    logger.info({ nowUtc: nowUtc.toISOString() }, 'Starting daily risk alert processing');

    const result: DailyRiskAlertResult = {
      eligibleTimezones: [],
      usersProcessed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      alreadyProcessed: 0,
      truncated: false,
      remaining: 0,
      results: [],
    };

    try {
      // Load fresh solar data into DB during the job (best-effort).
      // This also ensures GFZ raw contains future Kp datapoints.
      try {
        await withTimeout(
          spaceWeatherKpRepository.syncFromSources(nowUtc),
          SPACE_WEATHER_SYNC_TIMEOUT_MS,
          'space weather sync',
        );
      } catch (error) {
        logger.warn({ error }, 'Failed to sync space weather Kp during alert job; proceeding with DB data');
      }

      // Compute solar forecast context once per run (global, not per-user).
      const solarForecast = await this.getFutureSolarStormForecast(nowUtc);

      // Step 1: Get all users with alerts enabled (timezone is required to gate delivery).
      const users = await this.getUsersWithAlertsEnabled();

      if (users.length === 0) {
        logger.info('No users with alerts enabled');
        return result;
      }

      logger.info({ userCount: users.length }, 'Found users to process');

      // Check if we need to truncate
      if (users.length > MAX_USERS_PER_RUN) {
        result.truncated = true;
        logger.warn(
          { total: users.length, processing: MAX_USERS_PER_RUN },
          'Truncating users to prevent timeout',
        );
      }

      // Step 4: Process users with bounded concurrency, stopping when the budget runs out
      const usersToProcess = users.slice(0, MAX_USERS_PER_RUN);

      const { results: userResults, remaining } = await mapWithConcurrency(
        usersToProcess,
        USER_CONCURRENCY,
        (user: UserSettings) => this.processUserSafely(user, nowUtc, solarForecast),
        deadline,
      );

      result.results = userResults;
      result.usersProcessed = userResults.length;
      result.remaining = remaining;

      if (remaining > 0) {
        logger.info(
          { remaining, usersProcessed: userResults.length },
          'Daily risk alert run cut short by time budget; next tick will continue',
        );
      }

      // Count results
      for (const r of userResults) {
        switch (r.status) {
          case 'sent':
            result.sent++;
            break;
          case 'skipped':
            result.skipped++;
            break;
          case 'failed':
            result.failed++;
            break;
          case 'already_processed':
            result.alreadyProcessed++;
            break;
        }
      }

      // For diagnostics: collect distinct timezones that are currently in the allowed window.
      // (Name kept for backwards compatibility with existing cron response schema.)
      result.eligibleTimezones = Array.from(
        new Set(
          users
            .map(u => u.timezone)
            .filter(Boolean)
            .filter(tz => this.isInUserAllowedWindow(tz, nowUtc)),
        ),
      );
    } catch (error) {
      logger.error({ error }, 'Error processing daily risk alerts');
      throw error;
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        usersProcessed: result.usersProcessed,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        alreadyProcessed: result.alreadyProcessed,
        truncated: result.truncated,
        remaining: result.remaining,
      },
      'Daily risk alert processing complete',
    );

    return result;
  }

  /**
   * Get all users with alerts enabled
   */
  private async getUsersWithAlertsEnabled(): Promise<UserSettings[]> {
    const results = await db
      .select({
        userId: userWeatherSettingsSchema.userId,
        lat: userWeatherSettingsSchema.lat,
        lon: userWeatherSettingsSchema.lon,
        timezone: userWeatherSettingsSchema.timezone,
        preferredLanguage: userSchema.preferredLanguage,
      })
      .from(userWeatherSettingsSchema)
      .innerJoin(userSchema, eq(userSchema.id, userWeatherSettingsSchema.userId))
      .where(
        and(
          eq(userWeatherSettingsSchema.alertsEnabled, true),
          sql`${userWeatherSettingsSchema.timezone} IS NOT NULL`,
        ),
      );

    return results;
  }

  /**
   * Process one user, never throwing: a single bad user must not abort the run.
   */
  private async processUserSafely(
    user: UserSettings,
    nowUtc: Date,
    solarForecast: SolarForecast | null,
  ): Promise<UserAlertResult> {
    try {
      return await this.processUser(user, nowUtc, solarForecast);
    } catch (error) {
      logger.error({ userId: user.userId, error }, 'Error processing user');
      return {
        userId: user.userId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process a single user's daily risk alert
   */
  private async processUser(
    user: UserSettings,
    nowUtc: Date,
    solarForecast: SolarForecast | null,
  ): Promise<UserAlertResult> {
    // Gate: only send between 09:00 and 19:59 in the user's timezone.
    if (!this.isInUserAllowedWindow(user.timezone, nowUtc)) {
      return {
        userId: user.userId,
        status: 'skipped',
        solarHigh: false,
        wpiHigh: false,
      };
    }

    const localDate = getLocalDateString(user.timezone, nowUtc);

    // Determine risk levels
    let wpiScore: number | undefined;
    let wpiLevel: string | undefined;

    try {
      // Get WPI for user (same codepath as the widget).
      const wpiResult = await weatherPainIndexService.getCurrentWpi(user.userId);
      wpiScore = wpiResult.result.score;
      wpiLevel = wpiResult.result.level;
    } catch (error) {
      logger.warn({ userId: user.userId, error }, 'Failed to compute WPI for user');
    }

    // Determine if risk is high
    const wpiHigh = wpiScore !== undefined && wpiScore >= WPI_HIGH_THRESHOLD;
    const solarHigh = solarForecast !== null && solarForecast.kpIndex >= KP_STORM_THRESHOLD;

    // If neither is high, skip (do NOT create a run record so future runs can still trigger later today).
    if (!wpiHigh && !solarHigh) {
      return {
        userId: user.userId,
        status: 'skipped',
        wpiScore,
        wpiLevel,
        wpiHigh,
        solarHigh,
        solarForecastKp: solarForecast?.kpIndex ?? null,
        solarForecastTimestampUtc: solarForecast?.timestampUtc?.toISOString() ?? null,
      };
    }

    // Try to insert a run record (idempotency check). We only do this if we intend to send.
    const inserted = await this.tryInsertRunRecord(user.userId, localDate);

    if (!inserted) {
      return {
        userId: user.userId,
        status: 'already_processed',
        wpiScore,
        wpiLevel,
        wpiHigh,
        solarHigh,
        solarForecastKp: solarForecast?.kpIndex ?? null,
        solarForecastTimestampUtc: solarForecast?.timestampUtc?.toISOString() ?? null,
      };
    }

    const details = {
      wpiScore,
      wpiLevel,
      wpiHigh,
      solarHigh,
      solarForecastKp: solarForecast?.kpIndex ?? null,
      solarForecastTimestampUtc: solarForecast?.timestampUtc?.toISOString() ?? null,
      timezone: user.timezone,
    };

    // Send notification
    try {
      await this.sendRiskNotification(
        user.userId,
        wpiHigh,
        wpiScore,
        solarForecast?.kpIndex ?? null,
        solarForecast?.timestampUtc ?? null,
        user.timezone,
        user.preferredLanguage,
      );
      await this.updateRunRecord(user.userId, localDate, RiskAlertStatus.SENT, details);

      return {
        userId: user.userId,
        status: 'sent',
        ...details,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateRunRecord(user.userId, localDate, RiskAlertStatus.FAILED, {
        ...details,
        errorMessage,
      });

      return {
        userId: user.userId,
        status: 'failed',
        ...details,
        error: errorMessage,
      };
    }
  }

  /**
   * Try to insert a run record. Returns true if inserted, false if already exists.
   */
  private async tryInsertRunRecord(userId: string, localDate: string): Promise<boolean> {
    try {
      const result = await db
        .insert(riskAlertRunSchema)
        .values({
          userId,
          localDate,
          type: RiskAlertType.DAILY_RISK,
          status: RiskAlertStatus.SKIPPED, // Initial status
        })
        .onConflictDoNothing()
        .returning({ id: riskAlertRunSchema.id });

      return result.length > 0;
    } catch (error) {
      // Unique constraint violation means already processed
      logger.debug({ userId, localDate, error }, 'Run record already exists');
      return false;
    }
  }

  /**
   * Update a run record's status and details
   */
  private async updateRunRecord(
    userId: string,
    localDate: string,
    status: (typeof RiskAlertStatus)[keyof typeof RiskAlertStatus],
    details: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(riskAlertRunSchema)
      .set({ status, details })
      .where(
        and(
          eq(riskAlertRunSchema.userId, userId),
          eq(riskAlertRunSchema.localDate, localDate),
          eq(riskAlertRunSchema.type, RiskAlertType.DAILY_RISK),
        ),
      );
  }

  /**
   * Send a risk notification to a user
   */
  private async sendRiskNotification(
    userId: string,
    wpiHigh: boolean,
    wpiScore?: number,
    solarForecastKp?: number | null,
    solarForecastTimestampUtc?: Date | null,
    timezone?: string,
    preferredLanguage?: SupportedLanguageType,
  ): Promise<void> {
    const t = await getServerTranslator(preferredLanguage, 'Push');
    const title = t('dailyRisk.title');
    const parts: string[] = [];

    if (wpiHigh) {
      parts.push(
        t('dailyRisk.wpiPart', {
          score: wpiScore?.toFixed(1) ?? '',
        }),
      );
    }

    const solarHigh = solarForecastKp != null && solarForecastKp >= KP_STORM_THRESHOLD;
    if (solarHigh) {
      const kpStr = solarForecastKp.toFixed(1);
      let expectedAt: string | null = null;
      if (solarForecastTimestampUtc && timezone) {
        expectedAt = DateTime.fromJSDate(solarForecastTimestampUtc, { zone: 'utc' })
          .setZone(timezone)
          .toFormat('MMM d, HH:mm');
      }
      parts.push(
        t('dailyRisk.solarPart', {
          expectedAt: expectedAt ?? t('dailyRisk.unknownTime'),
          timezone: timezone ?? t('dailyRisk.localTime'),
          kp: kpStr,
        }),
      );
    }

    const body = parts.join(' ');

    await pushService.sendToUser(userId, {
      title,
      body,
      icon: '/android-chrome-192x192.png',
      badge: '/android-icon-72x72.png',
      url: '/dashboard',
      tag: 'daily-risk-alert',
      requireInteraction: false,
    });
  }

  /**
   * Compute global "future storm" forecast from GFZ raw stored in DB.
   * We look at future datapoints (ts > nowUtc), take the max Kp, and keep the earliest timestamp for that max.
   */
  private async getFutureSolarStormForecast(nowUtc: Date): Promise<SolarForecast | null> {
    const [latestGfz] = await db
      .select({ raw: solarActivitySnapshotSchema.raw })
      .from(solarActivitySnapshotSchema)
      .where(eq(solarActivitySnapshotSchema.source, 'gfz'))
      .orderBy(desc(solarActivitySnapshotSchema.timestampUtc))
      .limit(1);

    if (!latestGfz?.raw) {
      return null;
    }

    const forecast = this.extractFutureMaxKpFromGfzRaw(latestGfz.raw, nowUtc);
    if (!forecast) {
      return null;
    }

    return { ...forecast, source: 'gfz' };
  }

  private extractFutureMaxKpFromGfzRaw(
    rawContainer: Record<string, unknown>,
    nowUtc: Date,
  ): Omit<SolarForecast, 'source'> | null {
    // Stored shape (see SpaceWeatherKpRepository): { fetchedAt, meta, raw: <GFZ payload> }
    const candidate = (rawContainer as any)?.raw ?? rawContainer;
    const datetimes = (candidate as any)?.datetime;
    const kps = (candidate as any)?.Kp;

    if (!Array.isArray(datetimes) || !Array.isArray(kps) || datetimes.length !== kps.length) {
      return null;
    }

    let best: { kpIndex: number; timestampUtc: Date } | null = null;
    for (let i = 0; i < datetimes.length; i++) {
      const ts = new Date(String(datetimes[i] ?? ''));
      const kp = typeof kps[i] === 'number' ? kps[i] : Number.parseFloat(String(kps[i] ?? ''));
      if (Number.isNaN(ts.getTime()) || !Number.isFinite(kp)) {
        continue;
      }
      if (ts.getTime() <= nowUtc.getTime()) {
        continue;
      }

      if (!best || kp > best.kpIndex || (kp === best.kpIndex && ts.getTime() < best.timestampUtc.getTime())) {
        best = { kpIndex: kp, timestampUtc: ts };
      }
    }

    return best;
  }

  private isInUserAllowedWindow(timezone: string, nowUtc: Date): boolean {
    try {
      const local = DateTime.fromJSDate(nowUtc, { zone: timezone });
      if (!local.isValid) {
        logger.warn({ timezone, error: local.invalidReason }, 'Invalid timezone');
        return false;
      }
      return isNotBetween8pmAnd9am(local);
    } catch (error) {
      logger.error({ timezone, error }, 'Error checking allowed window');
      return false;
    }
  }
}

// Singleton instance
export const dailyRiskAlertService = new DailyRiskAlertService();
