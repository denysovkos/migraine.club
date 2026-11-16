import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { spaceWeatherKpRepository } from '@/repositories/SpaceWeatherKpRepository';

export async function GET() {
  // Keep consistent with other dashboard APIs: require auth.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // DB-backed: do not hit upstream providers on each request.
  const agg = await spaceWeatherKpRepository.getAggregateFromDb();

  return NextResponse.json({
    avgKp: agg.avgKp,
    sourcesUsed: agg.sourcesUsed,
    computedAt: agg.computedAt.toISOString(),
    minKp: agg.minKp ?? null,
    maxKp: agg.maxKp ?? null,
    spread: agg.spread ?? null,
    noaaScale: agg.noaaScale ?? null,
    lastStorm: agg.lastStorm
      ? {
          startTime: agg.lastStorm.startTime.toISOString(),
          endTime: agg.lastStorm.endTime.toISOString(),
          peakKp: agg.lastStorm.peakKp,
          peakTime: agg.lastStorm.peakTime.toISOString(),
        }
      : null,
    error: agg.error ?? null,
    readings: agg.readings.map(r => ({
      provider: r.provider,
      value: r.value,
      timestamp: r.timestamp.toISOString(),
      stale: r.stale,
      raw: r.raw ?? null,
      meta: r.meta ?? null,
    })),
  });
}
