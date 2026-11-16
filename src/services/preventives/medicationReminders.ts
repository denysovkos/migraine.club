import type { Deadline } from '@/libs/asyncLimits';
import type { LocalDateString } from '@/services/localDate';
import type { PreventiveSchedulePayload } from '@/types/Preventives';

import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { mapWithConcurrency } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  preventiveIntakeEventSchema,
  preventivePlanSchema,
  preventiveReminderLogSchema,
} from '@/models/Schema';
import { pushService } from '@/server/push/push.service';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { getUserTimezone } from '@/services/userTimezone';
import { PreventiveIntakeState, PreventivePlanStatus } from '@/types/Preventives';

import { isDueOnDate } from './schedule';

/**
 * How late a slot may still fire.
 *
 * The cron is expected to tick every 30 minutes, so a slot is normally picked
 * up on the first tick at or after it. This window is what lets a few missed
 * ticks (a deploy, an outage, a slow run that held the lease) still deliver
 * the reminder, while making sure a morning dose is never pushed at midnight.
 */
export const MAX_LATE_MINUTES = 90;

/**
 * Per-plan work is two small reads plus a push send; 8 in flight is what the
 * pg pool and the push provider comfortably absorb (same as programs).
 */
const PLAN_CONCURRENCY = 8;

export type ReminderProcessResult = {
  /** Reminders actually pushed. */
  sent: number;
  /** Plans skipped because today is not a scheduled day. */
  notDueToday: number;
  /** Plans skipped because the dose was already logged as taken today. */
  alreadyLogged: number;
  /** Due slots that had already been reminded on an earlier tick. */
  alreadyReminded: number;
  /** Sends that reached no device (the user has no push subscription). */
  noSubscription: number;
  /** Plans never started because the time budget ran out. */
  remaining: number;
  /** Plans that threw; the next tick retries them. */
  failed: number;
};

/**
 * Returns true if `slot` (user-local HH:mm) has arrived and is not stale.
 *
 * Pure, so the firing rule is testable without a clock, a DB or a push provider.
 */
export function isSlotDue(args: {
  nowLocal: DateTime;
  slot: string;
  maxLateMinutes?: number;
}): boolean {
  const [hour, minute] = args.slot.split(':').map(Number);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return false;
  }

  const target = args.nowLocal.set({ hour, minute, second: 0, millisecond: 0 });
  const minutesLate = args.nowLocal.diff(target, 'minutes').minutes;

  return minutesLate >= 0 && minutesLate <= (args.maxLateMinutes ?? MAX_LATE_MINUTES);
}

/**
 * The slots of a plan that should fire right now: due, and not already sent.
 *
 * `sentSlots` is what the reminder log holds for the same local date, which is
 * what makes a re-run of the same tick a no-op.
 */
export function dueSlots(args: {
  nowLocal: DateTime;
  slots: string[];
  sentSlots: Set<string>;
  maxLateMinutes?: number;
}): string[] {
  return args.slots.filter(
    slot => !args.sentSlots.has(slot)
      && isSlotDue({ nowLocal: args.nowLocal, slot, maxLateMinutes: args.maxLateMinutes }),
  );
}

/** Body line of the push: the dose when the user recorded one, else the time. */
export function reminderBody(args: { doseText: string | null; slot: string }): string {
  return args.doseText?.trim()
    ? `${args.doseText.trim()} · ${args.slot}`
    : `Scheduled for ${args.slot}`;
}

type PlanRow = {
  id: string;
  userId: string;
  name: string;
  doseText: string | null;
  scheduleType: string;
  schedulePayload: unknown;
  startDate: Date;
  reminderTimes: string[];
};

/**
 * Resolve each user's timezone once per run — a run covers many more plans
 * than users, and each lookup is its own pair of queries.
 */
async function resolveTimezones(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  const run = await mapWithConcurrency(
    unique,
    PLAN_CONCURRENCY,
    async userId => [userId, await getUserTimezone(userId)] as const,
  );

  return new Map(run.results);
}

async function processPlan(
  plan: PlanRow,
  timezone: string,
  stats: ReminderProcessResult,
): Promise<void> {
  const nowLocal = DateTime.now().setZone(timezone);
  const localDate = nowLocal.toISODate() as LocalDateString;

  const isScheduledToday = isDueOnDate({
    plan: {
      id: plan.id,
      // `kind` plays no part in whether a day is scheduled; the schedule
      // engine only reads scheduleType/payload/startDate.
      kind: 'oral',
      scheduleType: plan.scheduleType as never,
      schedulePayload: plan.schedulePayload as PreventiveSchedulePayload,
      startDate: dbDateToYmd(plan.startDate),
      status: PreventivePlanStatus.ACTIVE,
    },
    localDate,
    timezone,
  });

  if (!isScheduledToday) {
    stats.notDueToday += 1;
    return;
  }

  // Nothing to nag about once the dose is recorded for the day — the plan is
  // day-level, so a single intake event covers every slot on it.
  const [intake] = await db
    .select({ state: preventiveIntakeEventSchema.state })
    .from(preventiveIntakeEventSchema)
    .where(
      and(
        eq(preventiveIntakeEventSchema.planId, plan.id),
        eq(preventiveIntakeEventSchema.localDate, ymdToDbDate(localDate)),
      ),
    )
    .limit(1);

  if (intake?.state === PreventiveIntakeState.TAKEN) {
    stats.alreadyLogged += 1;
    return;
  }

  const sentRows = await db
    .select({ timeSlot: preventiveReminderLogSchema.timeSlot })
    .from(preventiveReminderLogSchema)
    .where(
      and(
        eq(preventiveReminderLogSchema.planId, plan.id),
        eq(preventiveReminderLogSchema.localDate, localDate),
        inArray(preventiveReminderLogSchema.timeSlot, plan.reminderTimes),
      ),
    );

  const sentSlots = new Set(sentRows.map(row => row.timeSlot));

  stats.alreadyReminded += plan.reminderTimes.filter(
    slot => sentSlots.has(slot) && isSlotDue({ nowLocal, slot }),
  ).length;

  for (const slot of dueSlots({ nowLocal, slots: plan.reminderTimes, sentSlots })) {
    const result = await pushService.sendToUser(plan.userId, {
      title: `Time for ${plan.name}`,
      body: reminderBody({ doseText: plan.doseText, slot }),
      tag: `preventive-${plan.id}-${localDate}-${slot}`,
      actions: [{ action: 'taken', title: '✅ Taken' }],
      data: {
        url: '/dashboard',
        deepLink: '/dashboard',
        // Reuses the service worker's action-button plumbing: the button posts
        // the intake so the user never has to open the app to confirm.
        programAction: {
          endpoint: '/api/preventives/intake',
          body: { planId: plan.id, localDate, state: PreventiveIntakeState.TAKEN },
        },
      },
    });

    if (result.sentCount === 0) {
      stats.noSubscription += 1;
      continue;
    }

    // Claimed after the send, matching the programs reminders: a user with no
    // device keeps the slot open until it goes stale, rather than burning it.
    await db
      .insert(preventiveReminderLogSchema)
      .values({ userId: plan.userId, planId: plan.id, localDate, timeSlot: slot })
      .onConflictDoNothing();

    stats.sent += 1;
  }
}

export const medicationRemindersService = {
  /**
   * Push a reminder for every scheduled dose that has come due since the last
   * tick. Idempotent: a slot that already has a `preventive_reminder_log` row
   * for the local date is never sent twice.
   */
  async process(deadline?: Deadline): Promise<ReminderProcessResult> {
    const stats: ReminderProcessResult = {
      sent: 0,
      notDueToday: 0,
      alreadyLogged: 0,
      alreadyReminded: 0,
      noSubscription: 0,
      remaining: 0,
      failed: 0,
    };

    const plans: PlanRow[] = await db
      .select({
        id: preventivePlanSchema.id,
        userId: preventivePlanSchema.userId,
        name: preventivePlanSchema.name,
        doseText: preventivePlanSchema.doseText,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        reminderTimes: preventivePlanSchema.reminderTimes,
      })
      .from(preventivePlanSchema)
      .where(
        and(
          eq(preventivePlanSchema.status, PreventivePlanStatus.ACTIVE),
          eq(preventivePlanSchema.remindersEnabled, true),
        ),
      );

    const actionable = plans.filter(plan => plan.reminderTimes.length > 0);

    if (actionable.length === 0) {
      return stats;
    }

    const timezones = await resolveTimezones(actionable.map(plan => plan.userId));

    // `mapWithConcurrency` requires `fn` never to throw, so one bad plan
    // (push provider hiccup, unusable timezone) cannot abort the whole run.
    const run = await mapWithConcurrency(actionable, PLAN_CONCURRENCY, async (plan) => {
      try {
        await processPlan(plan, timezones.get(plan.userId) ?? 'UTC', stats);
      } catch (error) {
        stats.failed += 1;
        logger.error({ error, planId: plan.id }, 'medication-reminders: plan failed');
      }
    }, deadline);

    stats.remaining += run.remaining;

    return stats;
  },
};
