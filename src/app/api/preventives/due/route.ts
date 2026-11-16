import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { preventivePlansService } from '@/services/preventives/PreventivePlansService';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const hasConsent = await hasHealthDataConsent(userId);
  if (!hasConsent) {
    return NextResponse.json(
      { error: 'Health data consent required', code: 'CONSENT_REQUIRED' },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const localDate = url.searchParams.get('localDate') ?? undefined;

  const result = await preventivePlansService.getDuePlans({ userId, localDate: localDate ?? undefined });
  const insight = await preventivePlansService.getRecentInsight({ userId });

  return NextResponse.json({ ...result, insight });
}

export const dynamic = 'force-dynamic';
