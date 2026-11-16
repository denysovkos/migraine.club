import type { Deadline } from '@/libs/asyncLimits';
import type { SupportedLanguageType } from '@/models/Schema';

import { and, inArray, isNull, lt, sql } from 'drizzle-orm';
import { mapWithConcurrency } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { getServerTranslator } from '@/libs/i18nMessages';
import { logger } from '@/libs/Logger';
import { episodeSchema, userSchema } from '@/models/Schema';
import { pushService } from '@/server/push/push.service';

export type StaleEpisodeReminderResult = {
  scanned: number;
  eligible: number;
  notified: number;
  skippedNotConfigured: boolean;
  failed: number;
  /** Claimed episodes never started because the time budget ran out. */
  remaining: number;
};

const HOURS_48_MS = 48 * 60 * 60 * 1000;
// The claim marks episodes as reminded *before* sending, so anything claimed but
// not sent is lost — it will never be re-claimed. Cap the claim to what one run
// can realistically deliver inside its budget; the hourly cadence drains the rest.
const MAX_EPISODES_PER_RUN = 500;
// Each episode is a translator lookup plus a push send; 8 at a time drains the
// claim quickly without pushing past the pg pool or the push provider's limits.
const EPISODE_CONCURRENCY = 8;

export class StaleEpisodeReminderService {
  async process(nowUtc: Date = new Date(), deadline?: Deadline): Promise<StaleEpisodeReminderResult> {
    const startedAt = Date.now();

    if (!pushService.isConfigured()) {
      logger.warn('Push not configured; skipping stale episode reminders');
      return {
        scanned: 0,
        eligible: 0,
        notified: 0,
        skippedNotConfigured: true,
        failed: 0,
        remaining: 0,
      };
    }

    const cutoff = new Date(nowUtc.getTime() - HOURS_48_MS);

    // Claim episodes idempotently: mark as "sent" first to avoid duplicates under concurrency.
    // NOTE: This means a notification failure may still mark it as sent; we accept this to avoid spamming.
    const claimed = await db
      .update(episodeSchema)
      .set({
        staleReminderSentAt: nowUtc,
        staleReminderCount: sql`${episodeSchema.staleReminderCount} + 1`,
      })
      .where(
        // Bounded via subquery because Postgres UPDATE has no LIMIT. The predicate is
        // repeated on the outer UPDATE so the claim stays atomic.
        and(
          isNull(episodeSchema.endTime),
          lt(episodeSchema.startTime, cutoff),
          isNull(episodeSchema.staleReminderSentAt),
          inArray(
            episodeSchema.id,
            db
              .select({ id: episodeSchema.id })
              .from(episodeSchema)
              .where(
                and(
                  isNull(episodeSchema.endTime),
                  lt(episodeSchema.startTime, cutoff),
                  isNull(episodeSchema.staleReminderSentAt),
                ),
              )
              .limit(MAX_EPISODES_PER_RUN),
          ),
        ),
      )
      .returning({
        id: episodeSchema.id,
        userId: episodeSchema.userId,
        startTime: episodeSchema.startTime,
      });

    const userIds = Array.from(new Set(claimed.map(ep => ep.userId).filter(Boolean)));
    const userLangRows = userIds.length === 0
      ? []
      : await db
          .select({
            userId: userSchema.id,
            preferredLanguage: userSchema.preferredLanguage,
          })
          .from(userSchema)
          .where(inArray(userSchema.id, userIds));

    const langByUserId = new Map<string, SupportedLanguageType>(
      userLangRows.map(r => [r.userId, r.preferredLanguage]),
    );

    let failed = 0;
    const { remaining } = await mapWithConcurrency(claimed, EPISODE_CONCURRENCY, async (ep) => {
      try {
        const locale = langByUserId.get(ep.userId);
        const t = await getServerTranslator(locale, 'Push');

        await pushService.sendToUser(ep.userId, {
          title: t('staleEpisode.title'),
          body: t('staleEpisode.body'),
          icon: '/android-chrome-192x192.png',
          badge: '/android-icon-72x72.png',
          url: `/dashboard/episodes/${ep.id}`,
          tag: `episode:${ep.id}:stale48h`,
          renotify: false,
          requireInteraction: false,
        });
      } catch (error) {
        failed++;
        logger.error({ error, episodeId: ep.id, userId: ep.userId }, 'Failed to send stale episode reminder');
      }
    }, deadline);

    const notified = claimed.length - remaining - failed;

    if (remaining > 0) {
      logger.info(
        { remaining, eligible: claimed.length },
        'Stale episode reminder run cut short by time budget',
      );
    }

    const duration = Date.now() - startedAt;
    logger.info(
      {
        duration,
        eligible: claimed.length,
        notified,
        failed,
        remaining,
      },
      'Stale episode reminder processing complete',
    );

    return {
      scanned: 0,
      eligible: claimed.length,
      notified,
      skippedNotConfigured: false,
      failed,
      remaining,
    };
  }
}

export const staleEpisodeReminderService = new StaleEpisodeReminderService();
