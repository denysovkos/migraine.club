import type { Deadline } from '@/libs/asyncLimits';
import type { SupportedLanguageType } from '@/models/Schema';
import { and, eq, isNotNull } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { mapWithConcurrency } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { getServerTranslator } from '@/libs/i18nMessages';
import { logger } from '@/libs/Logger';
import {
  riskAlertRunSchema,
  RiskAlertStatus,
  RiskAlertType,
  userSchema,
  userWeatherSettingsSchema,
} from '@/models/Schema';
import { pushService } from '@/server/push/push.service';
import { isNotBetween8pmAnd9am } from '@/services/DailyRiskAlertService';

import { pressureForecastService } from './PressureForecastService';
import { findUpcomingDrop } from './pressureOutlook';

const MAX_USERS_PER_RUN = 2000;
const USER_CONCURRENCY = 8;

type AlertUser = {
  userId: string;
  lat: number;
  lon: number;
  timezone: string;
  pressureDropThresholdHpa: number;
  preferredLanguage: SupportedLanguageType;
};

export type PressureAlertUserResult = {
  userId: string;
  status: 'sent' | 'skipped' | 'failed' | 'already_processed';
  dropDate?: string;
  dropHpa?: number;
  error?: string;
};

export type PressureAlertRunResult = {
  usersProcessed: number;
  sent: number;
  skipped: number;
  failed: number;
  alreadyProcessed: number;
  truncated: boolean;
  remaining: number;
  results: PressureAlertUserResult[];
};

/**
 * Sends a push when the forecast shows a day-over-day pressure fall at or
 * above the user's own threshold within the next two days.
 *
 * Framed as context ("pressure is forecast to fall"), never as an attack
 * prediction. One push per forecast drop day, deduplicated through
 * risk_alert_run with type `pressure_drop` and localDate = the drop day.
 */
export class PressureAlertService {
  async processAlerts(nowUtc: Date = new Date(), deadline?: Deadline): Promise<PressureAlertRunResult> {
    const result: PressureAlertRunResult = {
      usersProcessed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      alreadyProcessed: 0,
      truncated: false,
      remaining: 0,
      results: [],
    };

    const users = await this.getUsersWithThreshold();
    if (users.length === 0) {
      return result;
    }

    result.truncated = users.length > MAX_USERS_PER_RUN;
    const { results, remaining } = await mapWithConcurrency(
      users.slice(0, MAX_USERS_PER_RUN),
      USER_CONCURRENCY,
      (user: AlertUser) => this.processUserSafely(user, nowUtc),
      deadline,
    );

    result.results = results;
    result.usersProcessed = results.length;
    result.remaining = remaining;
    for (const r of results) {
      if (r.status === 'sent') {
        result.sent++;
      } else if (r.status === 'skipped') {
        result.skipped++;
      } else if (r.status === 'failed') {
        result.failed++;
      } else {
        result.alreadyProcessed++;
      }
    }

    logger.info(
      { usersProcessed: result.usersProcessed, sent: result.sent, failed: result.failed, remaining },
      'Pressure alert processing complete',
    );
    return result;
  }

  private async getUsersWithThreshold(): Promise<AlertUser[]> {
    const rows = await db
      .select({
        userId: userWeatherSettingsSchema.userId,
        lat: userWeatherSettingsSchema.lat,
        lon: userWeatherSettingsSchema.lon,
        timezone: userWeatherSettingsSchema.timezone,
        pressureDropThresholdHpa: userWeatherSettingsSchema.pressureDropThresholdHpa,
        preferredLanguage: userSchema.preferredLanguage,
      })
      .from(userWeatherSettingsSchema)
      .innerJoin(userSchema, eq(userSchema.id, userWeatherSettingsSchema.userId))
      .where(and(
        isNotNull(userWeatherSettingsSchema.pressureDropThresholdHpa),
        isNotNull(userWeatherSettingsSchema.timezone),
      ));

    return rows.filter((r): r is AlertUser => r.pressureDropThresholdHpa !== null);
  }

  private async processUserSafely(user: AlertUser, nowUtc: Date): Promise<PressureAlertUserResult> {
    try {
      return await this.processUser(user, nowUtc);
    } catch (error) {
      logger.error({ userId: user.userId, error }, 'Error processing pressure alert');
      return {
        userId: user.userId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async processUser(user: AlertUser, nowUtc: Date): Promise<PressureAlertUserResult> {
    const local = DateTime.fromJSDate(nowUtc, { zone: user.timezone });
    if (!isNotBetween8pmAnd9am(local)) {
      return { userId: user.userId, status: 'skipped' };
    }

    const outlook = await pressureForecastService.getOutlookForSettings(user, nowUtc);
    const todayLocal = local.toISODate()!;
    const drop = findUpcomingDrop(outlook.days, todayLocal);

    if (!drop || drop.changeHpa === null) {
      return { userId: user.userId, status: 'skipped' };
    }

    const dropHpa = Math.abs(drop.changeHpa);
    const inserted = await db
      .insert(riskAlertRunSchema)
      .values({
        userId: user.userId,
        localDate: drop.date,
        type: RiskAlertType.PRESSURE_DROP,
        status: RiskAlertStatus.SKIPPED,
      })
      .onConflictDoNothing()
      .returning({ id: riskAlertRunSchema.id });

    if (inserted.length === 0) {
      return { userId: user.userId, status: 'already_processed', dropDate: drop.date, dropHpa };
    }

    const details = {
      dropHpa,
      thresholdHpa: user.pressureDropThresholdHpa,
      timezone: user.timezone,
    };

    try {
      await this.sendNotification(user, drop.date, dropHpa, todayLocal);
      await this.updateRun(user.userId, drop.date, RiskAlertStatus.SENT, details);
      return { userId: user.userId, status: 'sent', dropDate: drop.date, dropHpa };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateRun(user.userId, drop.date, RiskAlertStatus.FAILED, { ...details, errorMessage });
      return { userId: user.userId, status: 'failed', dropDate: drop.date, dropHpa, error: errorMessage };
    }
  }

  private async updateRun(
    userId: string,
    localDate: string,
    status: (typeof RiskAlertStatus)[keyof typeof RiskAlertStatus],
    details: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(riskAlertRunSchema)
      .set({ status, details })
      .where(and(
        eq(riskAlertRunSchema.userId, userId),
        eq(riskAlertRunSchema.localDate, localDate),
        eq(riskAlertRunSchema.type, RiskAlertType.PRESSURE_DROP),
      ));
  }

  private async sendNotification(user: AlertUser, dropDate: string, dropHpa: number, todayLocal: string): Promise<void> {
    const t = await getServerTranslator(user.preferredLanguage, 'Push');
    const tomorrow = DateTime.fromISO(todayLocal).plus({ days: 1 }).toISODate();
    const day = dropDate === tomorrow
      ? t('pressureDrop.tomorrow')
      : t('pressureDrop.onDay', {
          weekday: DateTime.fromISO(dropDate).setLocale(user.preferredLanguage).toFormat('cccc'),
        });

    await pushService.sendToUser(user.userId, {
      title: t('pressureDrop.title'),
      body: t('pressureDrop.body', { drop: dropHpa.toFixed(1), day }),
      icon: '/android-chrome-192x192.png',
      badge: '/android-icon-72x72.png',
      url: '/dashboard',
      tag: 'pressure-drop-alert',
      requireInteraction: false,
    });
  }
}

export const pressureAlertService = new PressureAlertService();
