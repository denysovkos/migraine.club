import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { logger } from '@/libs/Logger';
import { pressureForecastService } from '@/services/pressure/PressureForecastService';

export const dynamic = 'force-dynamic';

// GET /api/weather/pressure-outlook - multi-day pressure outlook for the user's location
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await pressureForecastService.getSettings(userId);
    if (!settings) {
      return NextResponse.json(
        { error: 'Weather settings not configured', code: 'SETTINGS_NOT_FOUND' },
        { status: 404 },
      );
    }

    const outlook = await pressureForecastService.getOutlookForSettings(settings);
    return NextResponse.json(outlook);
  } catch (error) {
    logger.error({ error }, 'Error fetching pressure outlook');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
