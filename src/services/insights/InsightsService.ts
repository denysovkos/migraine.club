import type { EpisodeStart, FactorEvent, FactorInfo, InsightsEngineConfig } from './InsightsEngine';
import type { InsightsPayload } from './InsightsTypes';
import type { Deadline } from '@/libs/asyncLimits';

import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { mapWithConcurrency } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  dailyDiaryEntrySchema,
  episodeSchema,
  factorEventSchema,
  factorSchema,
  userConsentSchema,
} from '@/models/Schema';

import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { getUserTimezone } from '@/services/userTimezone';
import { insightsCacheStore } from './InsightsCacheStore';
import {
  computeInsightsForUser,
  DEFAULT_INSIGHTS_ENGINE_CONFIG,

} from './InsightsEngine';

// Lower than the notification jobs: each user costs several range queries plus the
// CPU-bound stats engine, so more in flight just starves the pg pool and the loop.
const INSIGHTS_USER_CONCURRENCY = 4;

export type InsightsComputeStatus
  = | { status: 'ok'; payload: InsightsPayload }
    | { status: 'insufficient_data'; payload: InsightsPayload; reason: string }
    | { status: 'no_strong_signals'; payload: InsightsPayload };

export class InsightsService {
  readonly methodVersion: string = DEFAULT_INSIGHTS_ENGINE_CONFIG.methodVersion;

  buildConfig(windowDays: number): InsightsEngineConfig {
    return {
      ...DEFAULT_INSIGHTS_ENGINE_CONFIG,
      windowDays,
    };
  }

  async hasHealthDataConsent(userId: string): Promise<boolean> {
    const consent = await db
      .select({ userId: userConsentSchema.userId })
      .from(userConsentSchema)
      .where(
        and(
          eq(userConsentSchema.userId, userId),
          eq(userConsentSchema.consentType, 'health_data'),
          isNull(userConsentSchema.withdrawnAt),
        ),
      )
      .limit(1);
    return consent.length > 0;
  }

  async getActiveConsentUsers(limit: number = 2000): Promise<string[]> {
    const rows = await db
      .selectDistinct({ userId: userConsentSchema.userId })
      .from(userConsentSchema)
      .where(
        and(
          eq(userConsentSchema.consentType, 'health_data'),
          isNull(userConsentSchema.withdrawnAt),
        ),
      )
      .limit(limit);
    return rows.map(r => r.userId);
  }

  async computeForUser(params: {
    userId: string;
    windowDays: number;
    nowUtc?: Date;
  }): Promise<InsightsComputeStatus> {
    const nowUtc = params.nowUtc ?? new Date();
    const cfg = this.buildConfig(params.windowDays);
    const start = new Date(nowUtc.getTime() - cfg.windowDays * 24 * 60 * 60 * 1000);
    const timezone = await getUserTimezone(params.userId);

    // Episodes (case moments)
    const episodes: EpisodeStart[] = await db
      .select({
        id: episodeSchema.id,
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        isOngoing: episodeSchema.isOngoing,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, params.userId),
          gte(episodeSchema.startTime, new Date(start.getTime() - 48 * 60 * 60 * 1000)),
          lte(episodeSchema.startTime, nowUtc),
        ),
      );

    // Factor events (diary logs) in window
    const events: FactorEvent[] = await db
      .select({
        factorId: factorEventSchema.factorId,
        occurredAt: factorEventSchema.occurredAt,
      })
      .from(factorEventSchema)
      .where(
        and(
          eq(factorEventSchema.userId, params.userId),
          gte(factorEventSchema.occurredAt, start),
          lte(factorEventSchema.occurredAt, nowUtc),
        ),
      );

    const endLocalStr = DateTime.fromJSDate(nowUtc, { zone: timezone }).toISODate()!;
    const startLocalStr = DateTime.fromISO(endLocalStr, { zone: timezone })
      .minus({ days: cfg.windowDays - 1 })
      .toISODate()!;

    const diaryEntries = await db
      .select({ localDate: dailyDiaryEntrySchema.localDate })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, params.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(startLocalStr as any)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(endLocalStr as any)),
        ),
      );

    const factorIds = Array.from(new Set(events.map(e => e.factorId)));
    const factors: FactorInfo[] = factorIds.length === 0
      ? []
      : await db
          .select({
            id: factorSchema.id,
            displayName: factorSchema.displayName,
            type: factorSchema.type,
          })
          .from(factorSchema)
          .where(inArray(factorSchema.id, factorIds));

    const result = computeInsightsForUser({
      userId: params.userId,
      nowUtc,
      cfg,
      episodes,
      factors,
      factorEvents: events,
      diaryEntries: diaryEntries.map(d => ({ localDate: dbDateToYmd(d.localDate) })),
      timezone,
    });

    if (result.status === 'ok') {
      return { status: 'ok', payload: result.payload };
    }
    if (result.status === 'no_strong_signals') {
      return { status: 'no_strong_signals', payload: result.payload };
    }
    return { status: 'insufficient_data', payload: result.payload, reason: result.reason };
  }

  async computeAndStoreForUser(params: {
    userId: string;
    windowDays: number;
    nowUtc?: Date;
  }): Promise<InsightsComputeStatus> {
    const nowUtc = params.nowUtc ?? new Date();
    const cfg = this.buildConfig(params.windowDays);

    const startedAt = Date.now();
    const result = await this.computeForUser({ userId: params.userId, windowDays: params.windowDays, nowUtc });

    try {
      await insightsCacheStore.upsert({
        userId: params.userId,
        windowDays: params.windowDays,
        methodVersion: cfg.methodVersion,
        payload: result.payload,
        inputStats: result.payload.inputStats,
        computedAt: nowUtc,
      });
    } catch (error) {
      logger.error(
        { userId: params.userId, windowDays: params.windowDays, error },
        'Failed to upsert insights cache',
      );
    }

    const totalCards = result.payload.buckets.reduce((sum, b) => sum + b.items.length, 0);
    const metric = result.status === 'insufficient_data'
      ? 'insights_compute_insufficient_data'
      : 'insights_compute_success';
    logger.info(
      {
        metric,
        userId: params.userId,
        windowDays: params.windowDays,
        methodVersion: cfg.methodVersion,
        status: result.status,
        cards: totalCards,
        runtimeMs: Date.now() - startedAt,
      },
      'Insights computed',
    );

    return result;
  }

  /**
   * Recompute insights for every consenting user, bounded by `deadline`.
   *
   * Whatever is left over is reported as `remaining` so the next cron tick can
   * pick it up instead of the request being killed mid-run by the load balancer.
   */
  async computeForAllUsers(params: {
    windowDays: number;
    deadline?: Deadline;
    nowUtc?: Date;
  }): Promise<{ users: number; computed: number; insufficient: number; failed: number; remaining: number }> {
    const users = await this.getActiveConsentUsers();

    let computed = 0;
    let insufficient = 0;
    let failed = 0;

    const { remaining } = await mapWithConcurrency(
      users,
      INSIGHTS_USER_CONCURRENCY,
      async (userId: string) => {
        try {
          const res = await this.computeAndStoreForUser({
            userId,
            windowDays: params.windowDays,
            nowUtc: params.nowUtc,
          });
          computed++;
          if (res.status !== 'ok') {
            insufficient++;
          }
        } catch (error) {
          failed++;
          logger.error({ error, userId }, 'Insights compute failed for user');
        }
      },
      params.deadline,
    );

    return { users: users.length, computed, insufficient, failed, remaining };
  }
}

export const insightsService = new InsightsService();
