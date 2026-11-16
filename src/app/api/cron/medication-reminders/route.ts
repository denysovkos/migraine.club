import { createCronRoute } from '@/app/api/cron/_shared/withCron';
import { medicationRemindersService } from '@/services/preventives/medicationReminders';

// pg + node crypto: never let Next try to evaluate this route at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/cron/medication-reminders
 *
 * Fires a push reminder for every preventive plan dose whose scheduled time
 * has arrived in the user's own timezone.
 *
 * Which days a plan is due comes from its schedule (daily / weekdays / every N
 * days / …); the time of day comes from `preventive_plan.reminder_times`.
 * Reminders only go out for plans with `reminders_enabled`.
 *
 * Idempotency: preventive_reminder_log is unique per (plan, local date, slot),
 * so re-running a tick — or running more often than every 30 minutes — never
 * double-notifies. A slot missed by a few ticks still fires, up to 90 minutes
 * late (see MAX_LATE_MINUTES), after which it is dropped rather than sent at
 * the wrong time of day.
 *
 * Recommended schedule: every 30 minutes.
 *
 * Methods: POST or GET (some external cron providers only support GET).
 */
export const { POST, GET } = createCronRoute({
  name: 'medication-reminders',
  description: 'Medication reminders cron - runs every 30 minutes',
  runOnGet: true,
  run: async ({ deadline }) => {
    const result = await medicationRemindersService.process(deadline);

    return { ...result };
  },
});
