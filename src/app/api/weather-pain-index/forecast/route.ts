import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { logger } from '@/libs/Logger';
import { solarActivityRepository } from '@/repositories/SolarActivityRepository';

export const dynamic = 'force-dynamic';

export type SolarForecastAlert = {
  hasAlert: boolean;
  level: 'warning' | 'danger' | null;
  kpIndex: number | null;
  timestampUtc: string | null;
  message: string | null;
};

// GET /api/weather-pain-index/forecast - Get solar activity forecast alerts
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get latest Kp data - this will fetch from NOAA if needed
    const latestKp = await solarActivityRepository.getLatestKpIndex();

    if (!latestKp) {
      const response: SolarForecastAlert = {
        hasAlert: false,
        level: null,
        kpIndex: null,
        timestampUtc: null,
        message: null,
      };
      return NextResponse.json(response);
    }

    // Check if we should show an alert
    // Kp >= 5 is a geomagnetic storm (G1 or higher)
    // Kp >= 4 is elevated activity worth warning about
    let hasAlert = false;
    let level: 'warning' | 'danger' | null = null;
    let message: string | null = null;

    if (latestKp.kpIndex >= 5) {
      hasAlert = true;
      level = 'danger';
      message = 'solar_storm_warning';
    } else if (latestKp.kpIndex >= 4) {
      hasAlert = true;
      level = 'warning';
      message = 'high_activity_warning';
    }

    const response: SolarForecastAlert = {
      hasAlert,
      level,
      kpIndex: latestKp.kpIndex,
      timestampUtc: latestKp.timestampUtc.toISOString(),
      message,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error({ error }, 'Error fetching solar forecast');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
