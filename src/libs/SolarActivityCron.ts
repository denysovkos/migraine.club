import { CronJob } from 'cron';

import { logger } from '@/libs/Logger';
import { solarActivityRepository } from '@/repositories/SolarActivityRepository';

let cronJob: CronJob | null = null;

/**
 * Sync solar activity data from NOAA
 * Called on app startup and every 4 hours
 */
async function syncSolarActivity(): Promise<void> {
  try {
    logger.info('Starting solar activity sync');
    const result = await solarActivityRepository.syncFromNOAA();
    logger.info(
      { fetched: result.fetched, inserted: result.inserted },
      'Solar activity sync completed',
    );
  } catch (error) {
    logger.error({ error }, 'Solar activity sync failed');
  }
}

/**
 * Start the solar activity cron job
 * Runs immediately on startup, then every 4 hours
 */
export function startSolarActivityCron(): void {
  if (cronJob) {
    logger.warn('Solar activity cron job already running');
    return;
  }

  // Run every 4 hours: "0 */4 * * *" (at minute 0 of every 4th hour)
  cronJob = new CronJob(
    '0 */4 * * *',
    syncSolarActivity,
    null, // onComplete
    true, // start immediately
    undefined, // timeZone (use system default)
    null, // context
    true, // runOnInit - run immediately when started
  );

  logger.info('Solar activity cron job started (runs every 4 hours)');
}

/**
 * Stop the solar activity cron job (for graceful shutdown)
 */
export function stopSolarActivityCron(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Solar activity cron job stopped');
  }
}
