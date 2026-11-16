import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { factorOptionsService } from '@/services/factors/FactorOptionsService';

function isValidLocalDate(localDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate) && DateTime.fromISO(localDate, { zone: 'UTC' }).isValid;
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json(
      { error: 'Health data consent required', code: 'CONSENT_REQUIRED' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const localDate = searchParams.get('localDate') ?? undefined;
  if (localDate && !isValidLocalDate(localDate)) {
    return NextResponse.json({ error: 'Invalid localDate' }, { status: 400 });
  }

  const payload = await factorOptionsService.getOptions({ userId, localDate });

  return NextResponse.json(payload);
}

export const dynamic = 'force-dynamic';
