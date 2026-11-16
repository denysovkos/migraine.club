import type { Deadline } from '@/libs/asyncLimits';
import { and, eq, gte } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { mapWithConcurrency } from '@/libs/asyncLimits';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  acuteDosesSchema,
  episodeSchema,
  programEnrollmentSchema,
  programSettingsSchema,
} from '@/models/Schema';
import { getMOHStatus } from '@/services/acuteMedications/moh';

import { getProgramDefinition } from './programDefinitions';
import {
  sendEvalComplete,
  sendMorningCheckIn,
  sendOnsetNudge,
  sendWeeklyDigest,
  sendWindDown,
} from './programNotifications';
import { getAcuteProgressSummary, getSleepProgressSummary } from './programOutcomes';

const WIND_DOWN_LEAD_MINUTES = 30;
const MORNING_LAG_MINUTES = 30;
const ONSET_NUDGE_DELAY_MINUTES = 30;

/**
 * Tolerance window for matching "now" to a target time.
 * Cron runs every ~5 min; allow 6-minute window so we never miss a tick.
 */
const FIRE_WINDOW_MINUTES = 6;

/**
 * Per-enrollment work is a handful of DB round-trips plus a push send, so 8 in
 * flight is what the pg pool and the push provider comfortably absorb.
 */
const ENROLLMENT_CONCURRENCY = 8;

type ProcessResult = {
  windDown: number;
  morningCheckIn: number;
  onsetNudge: number;
  onsetNudgeSuppressedByMoh: number;
  weeklyDigest: number;
  evalComplete: number;
  skipped: number;
  /** Enrollments never started because the time budget ran out, summed across loops. */
  remaining: number;
};

const WEEKLY_DIGEST_HHMM = '18:00'; // Sunday evening user-local
const EVAL_COMPLETE_HHMM = '09:00'; // Day after window ends

/**
 * Returns true if MOH guardrail status warrants suppressing onset nudges.
 * 'exceeded' is an explicit overuse; 'approaching' is borderline. We suppress
 * both — the program goal is earlier dosing, NOT more total doses.
 */
export function shouldSuppressForMoh(status: 'ok' | 'approaching' | 'exceeded'): boolean {
  return status === 'exceeded' || status === 'approaching';
}

/**
 * Returns true if it's the right moment to fire an onset nudge for an attack:
 * roughly DELAY minutes after onset, within ±WINDOW minutes.
 */
export function isOnsetNudgeDue(args: {
  now: Date;
  onsetTime: Date;
  delayMinutes: number;
  windowMinutes: number;
}): boolean {
  const minutesSinceOnset = (args.now.getTime() - args.onsetTime.getTime()) / 60_000;
  return minutesSinceOnset >= args.delayMinutes
    && minutesSinceOnset <= args.delayMinutes + args.windowMinutes;
}

/**
 * Returns true if `nowLocal` is within ±FIRE_WINDOW_MINUTES of `targetLocalHHmm`
 * for the same calendar day in the user's timezone.
 *
 * `offsetMinutes` shifts the target — e.g. -30 for "30 minutes before bed time".
 */
export function isWithinFireWindow(nowLocal: DateTime, targetHHmm: string, offsetMinutes: number): boolean {
  const [h, m] = targetHHmm.split(':').map(Number);
  const target = nowLocal.set({ hour: h, minute: m, second: 0, millisecond: 0 }).plus({ minutes: offsetMinutes });
  const diffMin = Math.abs(nowLocal.diff(target, 'minutes').minutes);
  return diffMin <= FIRE_WINDOW_MINUTES;
}

export const programsRemindersService = {
  async process(deadline?: Deadline): Promise<ProcessResult> {
    const stats: ProcessResult = {
      windDown: 0,
      morningCheckIn: 0,
      onsetNudge: 0,
      onsetNudgeSuppressedByMoh: 0,
      weeklyDigest: 0,
      evalComplete: 0,
      skipped: 0,
      remaining: 0,
    };

    // ── Sleep regularity reminders ───────────────────────────────
    const sleepEnrollments = await db
      .select({
        userId: programEnrollmentSchema.userId,
        targetPayload: programEnrollmentSchema.targetPayload,
        timezone: programEnrollmentSchema.timezone,
        notificationsConfig: programSettingsSchema.notificationsConfig,
      })
      .from(programEnrollmentSchema)
      .leftJoin(
        programSettingsSchema,
        eq(programEnrollmentSchema.userId, programSettingsSchema.userId),
      )
      .where(
        and(
          eq(programEnrollmentSchema.programId, 'sleep-regularity'),
          eq(programEnrollmentSchema.status, 'active'),
        ),
      );

    const sleepRun = await mapWithConcurrency(sleepEnrollments, ENROLLMENT_CONCURRENCY, async (e) => {
      const target = e.targetPayload as { bedTime: string; wakeTime: string } | null;
      if (!target?.bedTime || !target?.wakeTime) {
        stats.skipped += 1;
        return;
      }
      const config = (e.notificationsConfig ?? {}) as Record<string, boolean | undefined>;
      const nowLocal = DateTime.now().setZone(e.timezone);
      const localDate = nowLocal.toISODate()!;

      try {
        if (config.windDown && isWithinFireWindow(nowLocal, target.bedTime, -WIND_DOWN_LEAD_MINUTES)) {
          await sendWindDown({
            userId: e.userId,
            programId: 'sleep-regularity',
            localDate,
            bedTime: target.bedTime,
          });
          stats.windDown += 1;
        }
        if (config.morningCheckIn && isWithinFireWindow(nowLocal, target.wakeTime, MORNING_LAG_MINUTES)) {
          await sendMorningCheckIn({
            userId: e.userId,
            programId: 'sleep-regularity',
            localDate,
            bedTime: target.bedTime,
            wakeTime: target.wakeTime,
          });
          stats.morningCheckIn += 1;
        }
      } catch (err) {
        logger.warn({ err, userId: e.userId }, 'sleep reminder failed');
      }
    }, deadline);
    stats.remaining += sleepRun.remaining;

    // ── Weekly digest + eval-complete for every active enrollment ────────
    const allActive = await db
      .select({
        id: programEnrollmentSchema.id,
        userId: programEnrollmentSchema.userId,
        programId: programEnrollmentSchema.programId,
        targetPayload: programEnrollmentSchema.targetPayload,
        startDate: programEnrollmentSchema.startDate,
        endDate: programEnrollmentSchema.endDate,
        baselineWindowStart: programEnrollmentSchema.baselineWindowStart,
        baselineWindowEnd: programEnrollmentSchema.baselineWindowEnd,
        evaluationWindowStart: programEnrollmentSchema.evaluationWindowStart,
        evaluationWindowEnd: programEnrollmentSchema.evaluationWindowEnd,
        rampDays: programEnrollmentSchema.rampDays,
        timezone: programEnrollmentSchema.timezone,
        notificationsConfig: programSettingsSchema.notificationsConfig,
      })
      .from(programEnrollmentSchema)
      .leftJoin(
        programSettingsSchema,
        eq(programEnrollmentSchema.userId, programSettingsSchema.userId),
      )
      .where(eq(programEnrollmentSchema.status, 'active'));

    const allActiveRun = await mapWithConcurrency(allActive, ENROLLMENT_CONCURRENCY, async (e) => {
      const config = (e.notificationsConfig ?? {}) as Record<string, boolean | undefined>;
      const nowLocal = DateTime.now().setZone(e.timezone);
      const localDate = nowLocal.toISODate()!;
      const enrollmentDto = {
        id: e.id,
        userId: e.userId,
        programId: e.programId,
        status: 'active' as const,
        targetPayload: e.targetPayload as Record<string, unknown>,
        startDate: e.startDate,
        endDate: e.endDate ?? null,
        baselineWindowStart: e.baselineWindowStart,
        baselineWindowEnd: e.baselineWindowEnd,
        evaluationWindowStart: e.evaluationWindowStart,
        evaluationWindowEnd: e.evaluationWindowEnd,
        rampDays: e.rampDays,
        timezone: e.timezone,
      };

      // Weekly digest: Sunday at WEEKLY_DIGEST_HHMM user-local.
      if (config.weeklyDigest && nowLocal.weekday === 7
        && isWithinFireWindow(nowLocal, WEEKLY_DIGEST_HHMM, 0)) {
        try {
          const summary = e.programId === 'acute-med-timing'
            ? await getAcuteProgressSummary({ userId: e.userId, enrollment: enrollmentDto, today: localDate })
            : await getSleepProgressSummary({ userId: e.userId, enrollment: enrollmentDto, today: localDate });
          const evalEndDt = DateTime.fromISO(e.evaluationWindowEnd, { zone: e.timezone });
          const daysToReview = Math.max(
            0,
            Math.floor(evalEndDt.diff(nowLocal.startOf('day'), 'days').days),
          );
          await sendWeeklyDigest({
            userId: e.userId,
            programId: e.programId,
            localDate,
            adherencePct: Math.round(summary.adherence * 100),
            daysToReview,
          });
          stats.weeklyDigest += 1;
        } catch (err) {
          logger.warn({ err, userId: e.userId, programId: e.programId }, 'weekly digest failed');
        }
      }

      // Eval-complete: morning of the day after evaluation_window_end.
      // We fire on `localDate === evaluationWindowEnd` if user is past the
      // configured time, or on the next day. Idempotent on (userId, programId,
      // localDate=evaluationWindowEnd).
      const evalEnd = e.evaluationWindowEnd;
      if (
        localDate >= evalEnd
        && isWithinFireWindow(nowLocal, EVAL_COMPLETE_HHMM, 0)
      ) {
        try {
          const def = getProgramDefinition(e.programId);
          await sendEvalComplete({
            userId: e.userId,
            programId: e.programId,
            // Pin the dedup key to evalEnd — fires only once across multiple cron ticks.
            localDate: evalEnd,
            programTitle: def?.frontmatter.title ?? e.programId,
          });
          stats.evalComplete += 1;
        } catch (err) {
          logger.warn({ err, userId: e.userId, programId: e.programId }, 'eval-complete push failed');
        }
      }
    }, deadline);
    stats.remaining += allActiveRun.remaining;

    // ── Acute med onset nudges ───────────────────────────────────
    const acuteEnrollments = await db
      .select({
        userId: programEnrollmentSchema.userId,
        timezone: programEnrollmentSchema.timezone,
        notificationsConfig: programSettingsSchema.notificationsConfig,
      })
      .from(programEnrollmentSchema)
      .leftJoin(
        programSettingsSchema,
        eq(programEnrollmentSchema.userId, programSettingsSchema.userId),
      )
      .where(
        and(
          eq(programEnrollmentSchema.programId, 'acute-med-timing'),
          eq(programEnrollmentSchema.status, 'active'),
        ),
      );

    const now = new Date();
    // Broad candidate filter: ongoing attacks started in last 24h. The exact
    // ±FIRE_WINDOW_MINUTES check happens in the loop using onset_at when set.
    const candidatesSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const acuteRun = await mapWithConcurrency(acuteEnrollments, ENROLLMENT_CONCURRENCY, async (e) => {
      const config = (e.notificationsConfig ?? {}) as Record<string, boolean | undefined>;
      if (!config.onsetNudge) {
        return;
      }

      // Find ongoing attacks whose onset (or start_time fallback) was ~30 min ago
      // and that have no dose yet.
      // Failures here are per-user: with other enrollments in flight, throwing out
      // of this callback would abandon them mid-send.
      let candidates: { id: number; startTime: Date; onsetAt: Date | null }[];
      try {
        candidates = await db
          .select({
            id: episodeSchema.id,
            startTime: episodeSchema.startTime,
            onsetAt: episodeSchema.onsetAt,
          })
          .from(episodeSchema)
          .where(
            and(
              eq(episodeSchema.userId, e.userId),
              eq(episodeSchema.isOngoing, true),
              gte(episodeSchema.startTime, candidatesSince),
            ),
          );
      } catch (err) {
        logger.warn({ err, userId: e.userId }, 'onset nudge candidate lookup failed');
        return;
      }

      // MOH guardrail check: do NOT nudge a user toward more meds if they're
      // already at or near the MOH threshold. We compute once per user per tick.
      let mohSuppressed = false;
      try {
        const mohStatus = await getMOHStatus(e.userId, now);
        if (shouldSuppressForMoh(mohStatus.status)) {
          mohSuppressed = true;
          logger.info(
            { userId: e.userId, mohStatus: mohStatus.status },
            'onset nudge suppressed by MOH guardrail',
          );
        }
      } catch (err) {
        // Fail closed: if MOH check errors, suppress to be safe.
        mohSuppressed = true;
        logger.warn({ err, userId: e.userId }, 'MOH check failed; suppressing onset nudge');
      }

      for (const attack of candidates) {
        // Skip if any acute dose already logged for this attack.
        // If the dedupe lookup itself fails, skip the attack rather than throw:
        // a missed nudge is recoverable on the next tick, an aborted run is not.
        let dose: { id: string } | undefined;
        try {
          [dose] = await db
            .select({ id: acuteDosesSchema.id })
            .from(acuteDosesSchema)
            .where(
              and(
                eq(acuteDosesSchema.userId, e.userId),
                eq(acuteDosesSchema.attackId, attack.id),
              ),
            )
            .limit(1);
        } catch (err) {
          logger.warn({ err, userId: e.userId, attackId: attack.id }, 'acute dose lookup failed');
          continue;
        }
        if (dose) {
          continue;
        }

        if (mohSuppressed) {
          stats.onsetNudgeSuppressedByMoh += 1;
          continue;
        }

        // Re-check the nudge window using true onset time. If user reported the
        // onset earlier than their log time, we should fire when (now - onset) ≈ 30 min.
        const onsetTime = attack.onsetAt ?? attack.startTime;
        if (!isOnsetNudgeDue({
          now,
          onsetTime,
          delayMinutes: ONSET_NUDGE_DELAY_MINUTES,
          windowMinutes: FIRE_WINDOW_MINUTES,
        })) {
          continue;
        }

        const localDate = DateTime
          .fromJSDate(onsetTime, { zone: e.timezone })
          .toISODate()!;

        try {
          await sendOnsetNudge({ userId: e.userId, attackId: attack.id, localDate });
          stats.onsetNudge += 1;
        } catch (err) {
          logger.warn({ err, userId: e.userId, attackId: attack.id }, 'onset nudge failed');
        }
      }
    }, deadline);
    stats.remaining += acuteRun.remaining;

    if (stats.remaining > 0) {
      logger.info({ remaining: stats.remaining }, 'programs reminders run cut short by time budget');
    }

    return stats;
  },
};
