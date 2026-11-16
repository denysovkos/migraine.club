import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { programSettingsService } from '@/services/programs/programSettingsService';
import { recordSleepAdherenceForDay } from '@/services/programs/recordSleepAdherence';

export const dynamic = 'force-dynamic';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const Body = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bedTimeLocal: Time.nullable(),
  wakeTimeLocal: Time.nullable(),
});

/**
 * POST /api/programs/sleep-regularity/log
 *
 * Records a sleep adherence event without requiring a diary entry. Used by
 * the dashboard chip so users can tap "On target" / "Skip" without first
 * having to log a day type. The diary remains the source of truth for
 * headache outcomes; this endpoint only writes to program_adherence_event.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  try {
    const body = Body.parse(await request.json());
    await recordSleepAdherenceForDay({
      userId,
      localDate: body.localDate,
      bedTimeLocal: body.bedTimeLocal,
      wakeTimeLocal: body.wakeTimeLocal,
      source: 'computed',
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
