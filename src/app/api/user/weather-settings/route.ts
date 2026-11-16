import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/libs/Logger';
import { weatherPainIndexService } from '@/services/WeatherPainIndexService';
import { UserWeatherSettingsSchema } from '@/types/WeatherPainIndex';

export const dynamic = 'force-dynamic';

// GET /api/user/weather-settings - Get user weather settings
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await weatherPainIndexService.getUserSettings(userId);

    if (!settings) {
      return NextResponse.json(
        { error: 'Weather settings not configured', code: 'SETTINGS_NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      lat: settings.lat,
      lon: settings.lon,
      locationLabel: settings.locationLabel,
      timezone: settings.timezone,
      units: settings.units,
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching weather settings');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// PUT /api/user/weather-settings - Update user weather settings
export async function PUT(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = UserWeatherSettingsSchema.parse(body);

    const settings = await weatherPainIndexService.upsertUserSettings(userId, {
      lat: validatedData.lat,
      lon: validatedData.lon,
      locationLabel: validatedData.locationLabel,
      timezone: validatedData.timezone,
      units: validatedData.units,
    });

    logger.info({ userId }, 'Weather settings updated');

    return NextResponse.json({
      lat: settings.lat,
      lon: settings.lon,
      locationLabel: settings.locationLabel,
      timezone: settings.timezone,
      units: settings.units,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.issues }, 'Validation error updating weather settings');
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }

    logger.error({ error }, 'Error updating weather settings');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
