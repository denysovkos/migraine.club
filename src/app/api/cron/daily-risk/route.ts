import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { dailyRiskAlertService } from '@/services/DailyRiskAlertService';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/cron/daily-risk
 *
 * Cron endpoint to process daily risk alerts.
 * Should be called every 4 hours.
 *
 * Logic:
 * 1. Load fresh solar data (GFZ/NOAA/NASA) into DB
 * 2. Get users with alerts enabled
 * 3. For each user, only consider delivery if local time is 09:00–19:59
 * 4. Send a grouped notification if WPI ≥ 5 and/or future max Kp ≥ 5
 * 5. Deduplicate by (userId, localDate, type)
 */
export const { POST, GET } = createCronRoute({
  name: 'daily-risk',
  description: 'Daily risk alert cron - runs every 4 hours',
  run: async ({ deadline }) => {
    const result = await dailyRiskAlertService.processAlerts(undefined, deadline);

    return {
      eligibleTimezones: result.eligibleTimezones,
      usersProcessed: result.usersProcessed,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      alreadyProcessed: result.alreadyProcessed,
      truncated: result.truncated,
      remaining: result.remaining,
    };
  },
});
