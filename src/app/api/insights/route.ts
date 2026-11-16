import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { insightsCacheStore } from '@/services/insights/InsightsCacheStore';
import { insightsService } from '@/services/insights/InsightsService';

const WindowDaysSchema = z.coerce.number().int().refine(v => [30, 60, 90, 180].includes(v), {
  message: 'windowDays must be one of 30, 60, 90, 180',
});

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!Env.ENABLE_F39_INSIGHTS) {
    return NextResponse.json({
      state: 'disabled',
      message: 'Insights are not enabled.',
    });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json(
      {
        state: 'consent_required',
        message: 'Health data consent required.',
      },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const windowDays = WindowDaysSchema.parse(searchParams.get('windowDays') ?? searchParams.get('window') ?? '90');

  const methodVersion = insightsService.methodVersion;
  const cached = await insightsCacheStore.getLatest({ userId, windowDays, methodVersion });

  const now = new Date();
  const staleMs = 24 * 60 * 60 * 1000;
  const isStale = !cached
    || cached.stale
    || now.getTime() - cached.computedAt.getTime() > staleMs;

  if (!cached || isStale) {
    try {
      const result = await insightsService.computeAndStoreForUser({ userId, windowDays, nowUtc: now });
      return NextResponse.json({
        state: 'ready',
        windowDays,
        methodVersion,
        payload: result.payload,
        computedAt: result.payload.computedAt,
        status: result.status,
      });
    } catch (error) {
      logger.error({ error, userId, windowDays }, 'Insights recompute failed');
      if (cached) {
        return NextResponse.json({
          state: 'ready',
          windowDays,
          methodVersion,
          payload: cached.payloadJson,
          computedAt: cached.computedAt.toISOString(),
          status: 'stale',
        });
      }
      return NextResponse.json({ error: 'Failed to compute insights' }, { status: 500 });
    }
  }

  return NextResponse.json({
    state: 'ready',
    windowDays,
    methodVersion,
    payload: cached.payloadJson,
    computedAt: cached.computedAt.toISOString(),
    status: 'ready',
  });
}
