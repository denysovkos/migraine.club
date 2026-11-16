import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { programsRemindersService } from '@/services/programs/programsRemindersService';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/cron/programs-reminders
 *
 * Fires per-user push reminders for active program enrollments:
 *   - Sleep regularity: wind-down (target bed − 30 min), morning check-in (target wake + 30 min)
 *   - Acute med timing: onset nudge (attack start + 30 min if no dose)
 *
 * Idempotency: program_notification_log table prevents duplicate sends within
 * the same local day (per-attack for onset nudges).
 *
 * Recommended schedule: every 5 minutes.
 *
 * Methods: POST or GET (some external cron providers only support GET).
 */
export const { POST, GET } = createCronRoute({
  name: 'programs-reminders',
  description: 'Programs reminders cron - runs every 5 minutes',
  runOnGet: true,
  run: async ({ deadline }) => {
    const result = await programsRemindersService.process(deadline);

    return { ...result };
  },
});
