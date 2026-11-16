import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { acuteDosesSchema, episodeSchema } from '@/models/Schema';
import { computeAcuteAttackSignal } from '@/services/programs/acuteAdherence';
import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/programs/acute-med-timing/attack/[id]
 *
 * Returns timing chip data for a specific attack:
 *   - active enrollment target
 *   - current onset-to-dose minutes (or null if no dose taken)
 *   - hit/miss/na signal
 *
 * 404 if module disabled or no active enrollment. 404 if attack not found.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const { id } = await params;
  const attackId = Number(id);
  if (!Number.isFinite(attackId)) {
    return NextResponse.json({ error: 'Bad attack id' }, { status: 400 });
  }

  const enrollment = await programEnrollmentService.getActive(userId, 'acute-med-timing');
  if (!enrollment) {
    return NextResponse.json({ error: 'Not enrolled' }, { status: 404 });
  }

  const [attack] = await db
    .select({
      id: episodeSchema.id,
      startTime: episodeSchema.startTime,
      onsetAt: episodeSchema.onsetAt,
    })
    .from(episodeSchema)
    .where(and(eq(episodeSchema.id, attackId), eq(episodeSchema.userId, userId)))
    .limit(1);
  if (!attack || !attack.startTime) {
    return NextResponse.json({ error: 'Attack not found' }, { status: 404 });
  }

  const onsetTime = attack.onsetAt ?? attack.startTime;

  const [firstDose] = await db
    .select({ takenAt: acuteDosesSchema.takenAt })
    .from(acuteDosesSchema)
    .where(and(eq(acuteDosesSchema.attackId, attackId), eq(acuteDosesSchema.userId, userId)))
    .orderBy(asc(acuteDosesSchema.takenAt))
    .limit(1);

  const onsetToDoseMinutes = firstDose
    ? Math.round((firstDose.takenAt.getTime() - onsetTime.getTime()) / 60000)
    : null;

  const target = enrollment.targetPayload as { acuteWindowMinutes: number };
  const { signal } = computeAcuteAttackSignal({
    targetMinutes: target.acuteWindowMinutes,
    onsetToDoseMinutes,
  });

  return NextResponse.json({
    targetMinutes: target.acuteWindowMinutes,
    onsetToDoseMinutes,
    signal,
  });
}
