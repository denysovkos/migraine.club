import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { Env } from '@/libs/Env';
import { insightsService } from '@/services/insights/InsightsService';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Conservative default window. */
const WINDOW_DAYS = 90;

/**
 * /api/cron/insights
 *
 * Daily insights computation job (Feature F39).
 */
export const { POST, GET } = createCronRoute({
  name: 'insights',
  description: 'Insights cron - recomputes conservative within-person associations',
  enabled: !!Env.ENABLE_F39_INSIGHTS,
  run: async ({ deadline }) => {
    const result = await insightsService.computeForAllUsers({ windowDays: WINDOW_DAYS, deadline });

    return { ...result };
  },
});
