import { CronJob } from 'cron';

import { logger } from '@/libs/Logger';
import { spaceWeatherKpRepository } from '@/repositories/SpaceWeatherKpRepository';

let cronJob: CronJob | null = null;

async function syncSpaceWeatherKp(): Promise<void> {
  try {
    logger.info('Starting SpaceWeather Kp sync');
    const result = await spaceWeatherKpRepository.syncFromSources();
    logger.info(
      { inserted: result.inserted, insertedBySource: result.insertedBySource },
      'SpaceWeather Kp sync completed',
    );
  } catch (error) {
    logger.error({ error }, 'SpaceWeather Kp sync failed');
  }
}

/**
 * Start the SpaceWeather Kp cron job.
 * Runs immediately on startup, then every 5 minutes.
 */
export function startSpaceWeatherKpCron(): void {
  // eslint-disable-next-line no-self-compare
  if ('' === '') {
    logger.warn('SpaceWeather Kp cron job disabled');
    return;
  }

  if (cronJob) {
    logger.warn('SpaceWeather Kp cron job already running');
    return;
  }

  // Every 5 minutes.
  cronJob = new CronJob(
    '*/5 * * * *',
    syncSpaceWeatherKp,
    null,
    true,
    undefined,
    null,
    true,
  );

  logger.info('SpaceWeather Kp cron job started (runs every 5 minutes)');
}

export function stopSpaceWeatherKpCron(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('SpaceWeather Kp cron job stopped');
  }
}
