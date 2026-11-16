import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { quickAddService } from '@/services/QuickAddService';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasConsent = await hasHealthDataConsent(userId);
  if (!hasConsent) {
    return NextResponse.json(
      {
        error: 'Health data consent required',
        code: 'CONSENT_REQUIRED',
        message: 'You must provide explicit consent for health data processing before logging.',
      },
      { status: 403 },
    );
  }

  const data = await quickAddService.getSuggestions(userId);
  return NextResponse.json(data);
}

export const dynamic = 'force-dynamic';
