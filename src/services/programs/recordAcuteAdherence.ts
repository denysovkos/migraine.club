import type { ProgramAdherenceSource } from '@/models/Schema';
import { and, asc, eq } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  acuteDosesSchema,
  episodeSchema,
  programAdherenceEventSchema,
  programEnrollmentSchema,
} from '@/models/Schema';

import { computeAcuteAttackSignal } from './acuteAdherence';

type AcuteTargetPayload = { acuteWindowMinutes: number };

/**
 * Records (or updates) the acute-med-timing adherence event for a single attack.
 *
 * Computes the gap between attack start time and the **earliest** acute dose
 * taken for that attack. Idempotent: safe to call repeatedly — re-runs after
 * additional doses won't move the signal (we keep the first dose's delta).
 *
 * Silent if:
 *   - user has no active acute-med-timing enrollment
 *   - episode date is outside enrollment window (start_date and onward)
 *   - episode has no startTime
 */
export async function recordAcuteAdherenceForAttack(args: {
  userId: string;
  attackId: number;
  source?: ProgramAdherenceSource;
}): Promise<void> {
  const [enrollment] = await db
    .select()
    .from(programEnrollmentSchema)
    .where(
      and(
        eq(programEnrollmentSchema.userId, args.userId),
        eq(programEnrollmentSchema.programId, 'acute-med-timing'),
        eq(programEnrollmentSchema.status, 'active'),
      ),
    )
    .limit(1);
  if (!enrollment) {
    return;
  }

  const [attack] = await db
    .select({
      id: episodeSchema.id,
      startTime: episodeSchema.startTime,
      onsetAt: episodeSchema.onsetAt,
    })
    .from(episodeSchema)
    .where(and(eq(episodeSchema.id, args.attackId), eq(episodeSchema.userId, args.userId)))
    .limit(1);
  if (!attack || !attack.startTime) {
    return;
  }

  // Prefer true onset_at when set; fall back to start_time (which equals log time on quick-add).
  const onsetTime = attack.onsetAt ?? attack.startTime;

  // Window guard: only count attacks on/after enrollment start date in user's tz.
  const attackLocalDate = DateTime
    .fromJSDate(onsetTime, { zone: enrollment.timezone })
    .toISODate();
  if (!attackLocalDate || attackLocalDate < enrollment.startDate) {
    return;
  }

  const [firstDose] = await db
    .select({ takenAt: acuteDosesSchema.takenAt })
    .from(acuteDosesSchema)
    .where(and(eq(acuteDosesSchema.attackId, args.attackId), eq(acuteDosesSchema.userId, args.userId)))
    .orderBy(asc(acuteDosesSchema.takenAt))
    .limit(1);

  const onsetToDoseMinutes = firstDose
    ? Math.round((firstDose.takenAt.getTime() - onsetTime.getTime()) / 60000)
    : null;

  const target = enrollment.targetPayload as AcuteTargetPayload;
  const { signal, onsetToDoseMinutes: deltaForPayload } = computeAcuteAttackSignal({
    targetMinutes: target.acuteWindowMinutes ?? 30,
    onsetToDoseMinutes,
  });

  // Idempotent: enrollment_id + attack_id is unique (partial index excludes localDate=null,
  // attackId NOT NULL). Try update-then-insert pattern.
  const [existing] = await db
    .select({ id: programAdherenceEventSchema.id })
    .from(programAdherenceEventSchema)
    .where(
      and(
        eq(programAdherenceEventSchema.enrollmentId, enrollment.id),
        eq(programAdherenceEventSchema.attackId, args.attackId),
      ),
    )
    .limit(1);

  const payload = { onsetToDoseMinutes: deltaForPayload };

  if (existing) {
    await db
      .update(programAdherenceEventSchema)
      .set({ signal, source: args.source ?? 'computed', payload })
      .where(eq(programAdherenceEventSchema.id, existing.id));
    return;
  }

  await db.insert(programAdherenceEventSchema).values({
    enrollmentId: enrollment.id,
    userId: args.userId,
    programId: 'acute-med-timing',
    attackId: args.attackId,
    signal,
    source: args.source ?? 'computed',
    payload,
  });
}
