import type { WpiHistoryResponse } from '@/types/WeatherPainIndex';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { weatherPainIndexService } from '@/services/WeatherPainIndexService';

export const dynamic = 'force-dynamic';

// GET /api/weather-pain-index/history - Get WPI history for the authenticated user
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const days = daysParam ? Number.parseInt(daysParam, 10) : 14;

    // Validate days parameter
    if (Number.isNaN(days) || days < 1 || days > 90) {
      return NextResponse.json(
        { error: 'Invalid days parameter. Must be between 1 and 90.' },
        { status: 400 },
      );
    }

    // Get WPI history
    const points = await weatherPainIndexService.getHistory(userId, days);

    const response: WpiHistoryResponse = {
      points,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error({ error }, 'Error fetching WPI history');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
