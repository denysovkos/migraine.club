import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { spaceWeatherKpRepository } from '@/repositories/SpaceWeatherKpRepository';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/cron/solar-activity
 *
 * Cron endpoint to sync solar activity data from all providers.
 * Should be called every 6 hours by an external scheduler.
 *
 * POST syncs Kp data from NOAA, GFZ, and NASA into the database.
 */
export const { POST, GET } = createCronRoute({
  name: 'solar-activity',
  description: 'Solar activity sync cron - runs every 6 hours',
  // Three provider fetches and one insert; nowhere near the default budget.
  budgetMs: 30_000,
  run: async () => {
    const result = await spaceWeatherKpRepository.syncFromSources();

    return {
      inserted: result.inserted,
      insertedBySource: result.insertedBySource,
    };
  },
});
