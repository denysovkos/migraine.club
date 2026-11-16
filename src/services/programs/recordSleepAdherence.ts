import type { ProgramAdherenceSource, SleepTargetPayload } from '@/models/Schema';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  programAdherenceEventSchema,
} from '@/models/Schema';

import { programEnrollmentService } from './programEnrollmentService';
import { computeSleepDailySignal } from './sleepAdherence';

/**
 * Best-effort: append (or update) the sleep regularity adherence event for a date.
 * Silent if no active enrollment, or date is outside the enrollment window.
 */
export async function recordSleepAdherenceForDay(args: {
  userId: string;
  localDate: string;
  bedTimeLocal: string | null;
  wakeTimeLocal: string | null;
  source?: ProgramAdherenceSource;
}): Promise<void> {
  const enrollment = await programEnrollmentService.getActive(args.userId, 'sleep-regularity');
  if (!enrollment) {
    return;
  }
  if (args.localDate < enrollment.startDate) {
    return;
  }

  const target = enrollment.targetPayload as SleepTargetPayload;
  const signal = computeSleepDailySignal({
    target,
    bedTime: args.bedTimeLocal,
    wakeTime: args.wakeTimeLocal,
  });

  // Partial unique index has WHERE attack_id IS NULL — Drizzle's onConflict cannot easily
  // express that, so emulate idempotent upsert with select-then-insert/update.
  const [existing] = await db
    .select({ id: programAdherenceEventSchema.id })
    .from(programAdherenceEventSchema)
    .where(
      and(
        eq(programAdherenceEventSchema.enrollmentId, enrollment.id),
        eq(programAdherenceEventSchema.localDate, args.localDate),
        isNull(programAdherenceEventSchema.attackId),
      ),
    )
    .limit(1);

  const payload = { bedTime: args.bedTimeLocal, wakeTime: args.wakeTimeLocal };

  if (existing) {
    await db
      .update(programAdherenceEventSchema)
      .set({ signal, source: args.source ?? 'diary', payload })
      .where(eq(programAdherenceEventSchema.id, existing.id));
    return;
  }

  await db.insert(programAdherenceEventSchema).values({
    enrollmentId: enrollment.id,
    userId: args.userId,
    programId: 'sleep-regularity',
    localDate: args.localDate,
    signal,
    source: args.source ?? 'diary',
    payload,
  });
}
