import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';
import { getUserTimezone } from '@/services/userTimezone';

export const dynamic = 'force-dynamic';

const SleepTarget = z.object({
  bedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  wakeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  toleranceMinutes: z.number().int().min(0).max(180),
});

const AcuteTarget = z.object({
  acuteWindowMinutes: z.number().int().min(1).max(360),
});

const Body = z.object({ targetPayload: z.union([SleepTarget, AcuteTarget]) });

export async function POST(
  request: Request,
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
  try {
    const { targetPayload } = Body.parse(await request.json());
    const timezone = await getUserTimezone(userId);
    const today = DateTime.now().setZone(timezone).toISODate()!;
    const enrollment = await programEnrollmentService.enroll({
      userId,
      programId,
      targetPayload,
      timezone,
      today,
    });
    return NextResponse.json(enrollment, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal' }, { status: 400 });
  }
}
