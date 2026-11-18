import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/libs/Logger';
import { pressureForecastService } from '@/services/pressure/PressureForecastService';
import { MAX_THRESHOLD_HPA, MIN_THRESHOLD_HPA } from '@/services/pressure/pressureOutlook';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  thresholdHpa: z.number().min(MIN_THRESHOLD_HPA).max(MAX_THRESHOLD_HPA).nullable(),
});

// GET /api/user/pressure-alert - the user's pressure-drop alert threshold
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await pressureForecastService.getSettings(userId);
    return NextResponse.json({
      hasLocation: settings !== null,
      thresholdHpa: settings?.pressureDropThresholdHpa ?? null,
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching pressure alert settings');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/user/pressure-alert - set the threshold in hPa, or null to turn alerts off
export async function PUT(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { thresholdHpa } = parsed.data;
    const updated = await pressureForecastService.setThreshold(userId, thresholdHpa);
    if (!updated) {
      return NextResponse.json(
        { error: 'Location not configured. Please set up your location first.', code: 'SETTINGS_NOT_FOUND' },
        { status: 400 },
      );
    }

    logger.info({ userId, thresholdHpa }, 'Updated pressure alert threshold');
    return NextResponse.json({ hasLocation: true, thresholdHpa });
  } catch (error) {
    logger.error({ error }, 'Error updating pressure alert settings');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
