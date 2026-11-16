import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { Env } from '@/libs/Env';
import { insightsCacheStore } from '@/services/insights/InsightsCacheStore';
import { insightsService } from '@/services/insights/InsightsService';

const WindowDaysSchema = z.coerce.number().int().refine(v => [30, 60, 90, 180].includes(v), {
  message: 'windowDays must be one of 30, 60, 90, 180',
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!Env.ENABLE_F39_INSIGHTS) {
    return NextResponse.json({ error: 'Insights are not enabled.' }, { status: 403 });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json({ error: 'Health data consent required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const windowDays = WindowDaysSchema.parse(body?.windowDays ?? '90');
  const methodVersion = insightsService.methodVersion;

  const cached = await insightsCacheStore.getLatest({ userId, windowDays, methodVersion });
  if (cached) {
    const recentMs = 5 * 60 * 1000;
    if (Date.now() - cached.computedAt.getTime() < recentMs) {
      return NextResponse.json({ error: 'Insights were recently refreshed.' }, { status: 429 });
    }
  }

  const result = await insightsService.computeAndStoreForUser({ userId, windowDays, nowUtc: new Date() });

  return NextResponse.json({
    state: 'ready',
    windowDays,
    methodVersion,
    payload: result.payload,
    computedAt: result.payload.computedAt,
    status: result.status,
  });
}
