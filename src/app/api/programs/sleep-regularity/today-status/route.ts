import { auth } from '@clerk/nextjs/server';
import { and, eq, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { programAdherenceEventSchema } from '@/models/Schema';
import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';
import { getUserTimezone } from '@/services/userTimezone';

export const dynamic = 'force-dynamic';

/**
 * GET /api/programs/sleep-regularity/today-status
 *
 * Returns today's sleep-regularity adherence event for the user, if any.
 * Used by the dashboard chip to restore selection state across reloads
 * (the chip writes to program_adherence_event, not the diary, so
 * fetchTodayDiary doesn't carry the chip's last action).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const enrollment = await programEnrollmentService.getActive(userId, 'sleep-regularity');
  if (!enrollment) {
    return NextResponse.json({ error: 'Not enrolled' }, { status: 404 });
  }
  const tz = await getUserTimezone(userId);
  const today = DateTime.now().setZone(tz).toISODate()!;

  const [row] = await db
    .select({
      signal: programAdherenceEventSchema.signal,
      payload: programAdherenceEventSchema.payload,
    })
    .from(programAdherenceEventSchema)
    .where(
      and(
        eq(programAdherenceEventSchema.enrollmentId, enrollment.id),
        eq(programAdherenceEventSchema.localDate, today),
        isNull(programAdherenceEventSchema.attackId),
      ),
    )
    .limit(1);

  return NextResponse.json({
    today,
    signal: row?.signal ?? null,
    payload: row?.payload ?? null,
  });
}
