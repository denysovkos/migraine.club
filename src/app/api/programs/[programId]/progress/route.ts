import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { computeConfidence } from '@/services/programs/confidence';
import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { getAcuteProgressSummary, getSleepProgressSummary } from '@/services/programs/programOutcomes';
import { programSettingsService } from '@/services/programs/programSettingsService';
import { getUserTimezone } from '@/services/userTimezone';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const { programId } = await params;
  const enrollment = await programEnrollmentService.getActive(userId, programId);
  if (!enrollment) {
    return NextResponse.json({ error: 'No active enrollment' }, { status: 404 });
  }
  const tz = await getUserTimezone(userId);
  const today = DateTime.now().setZone(tz).toISODate()!;
  const summary = programId === 'acute-med-timing'
    ? await getAcuteProgressSummary({ userId, enrollment, today })
    : await getSleepProgressSummary({ userId, enrollment, today });
  const confidence = computeConfidence({
    coverage: summary.coverage,
    adherence: summary.adherence,
    evalComplete: summary.evalComplete,
  });
  return NextResponse.json({ enrollment, summary, confidence });
}
