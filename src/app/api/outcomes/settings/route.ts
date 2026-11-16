import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { outcomesService } from '@/services/OutcomesService';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/outcomes/settings
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await outcomesService.getOutcomeSettings(userId);
  return NextResponse.json({
    baselineStart: settings.baselineStart?.toISOString() ?? null,
    baselineEnd: settings.baselineEnd?.toISOString() ?? null,
    preferredWindowDays: settings.preferredWindowDays,
    timezone: settings.timezone,
  });
}

const UpdateSettingsSchema = z.object({
  baselineFrom: Ymd.nullable().optional(),
  baselineTo: Ymd.nullable().optional(),
  preferredWindowDays: z.number().int().min(1).max(365).optional(),
});

/**
 * PUT /api/outcomes/settings
 */
export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = UpdateSettingsSchema.parse(body);

    const current = await outcomesService.getOutcomeSettings(userId);

    const baselineStart = data.baselineFrom
      ? DateTime.fromISO(data.baselineFrom, { zone: current.timezone }).startOf('day').toUTC().toJSDate()
      : (data.baselineFrom === null ? null : current.baselineStart);
    const baselineEnd = data.baselineTo
      ? DateTime.fromISO(data.baselineTo, { zone: current.timezone }).startOf('day').toUTC().toJSDate()
      : (data.baselineTo === null ? null : current.baselineEnd);

    await outcomesService.upsertOutcomeSettings({
      userId,
      baselineStart,
      baselineEnd,
      preferredWindowDays: data.preferredWindowDays ?? current.preferredWindowDays,
      timezone: null,
    });

    const updated = await outcomesService.getOutcomeSettings(userId);
    return NextResponse.json({
      baselineStart: updated.baselineStart?.toISOString() ?? null,
      baselineEnd: updated.baselineEnd?.toISOString() ?? null,
      preferredWindowDays: updated.preferredWindowDays,
      timezone: updated.timezone,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
