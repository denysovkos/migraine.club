import type { CurrentWpiResponse } from '@/types/WeatherPainIndex';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { weatherPainIndexService } from '@/services/WeatherPainIndexService';

export const dynamic = 'force-dynamic';

// GET /api/weather-pain-index/current - Get current WPI for the authenticated user
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has weather settings configured
    const settings = await weatherPainIndexService.getUserSettings(userId);
    if (!settings) {
      return NextResponse.json(
        {
          error: 'Weather settings not configured',
          code: 'SETTINGS_NOT_FOUND',
          message: 'Please configure your location to get weather pain index data.',
        },
        { status: 400 },
      );
    }

    // Get or compute current WPI
    const wpiData = await weatherPainIndexService.getCurrentWpi(userId);

    const response: CurrentWpiResponse = {
      timestamp: new Date().toISOString(),
      score: wpiData.result.score,
      level: wpiData.result.level,
      components: wpiData.result.components,
      weather: {
        deltaPressure: wpiData.weather.deltaPressure,
        temperatureDeviation: wpiData.weather.temperatureDeviation,
        humidity: wpiData.weather.humidity,
        windSpeed: wpiData.weather.windSpeed,
        uvi: wpiData.weather.uvi,
      },
      solar: {
        kpIndex: wpiData.kpIndex,
        timestampUtc: wpiData.solarSnapshot?.timestampUtc.toISOString() ?? null,
        source: wpiData.solarSnapshot?.source ?? null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error({ error }, 'Error fetching current WPI');

    if (error instanceof Error && error.message.includes('settings not found')) {
      return NextResponse.json(
        {
          error: 'Weather settings not configured',
          code: 'SETTINGS_NOT_FOUND',
          message: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
