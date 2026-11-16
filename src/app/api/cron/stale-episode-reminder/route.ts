import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { Env } from '@/libs/Env';
import { staleEpisodeReminderService } from '@/services/StaleEpisodeReminderService';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/cron/stale-episode-reminder
 *
 * Hourly job: if an episode remains open (not closed) for 48 hours after it started,
 * send a push notification reminder to close it. Idempotent via episode.stale_reminder_sent_at.
 *
 * Methods: POST or GET (some external cron providers only support GET).
 */
export const { POST, GET } = createCronRoute({
  name: 'stale-episode-reminder',
  description: 'Stale episode reminder cron - runs hourly',
  enabled: !!Env.ENABLE_STALE_EPISODE_REMINDER,
  runOnGet: true,
  run: async ({ deadline }) => {
    const result = await staleEpisodeReminderService.process(undefined, deadline);

    return { ...result };
  },
});
