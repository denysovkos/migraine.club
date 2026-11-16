import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { getAcuteMedsReport } from '@/services/acuteMedications/acuteReport';

const QuerySchema = z.object({
  mode: z.enum(['rolling30', 'calendarMonth']).optional(),
});

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

  try {
    const { searchParams } = new URL(request.url);
    const query = QuerySchema.parse({
      mode: searchParams.get('mode') ?? undefined,
    });
    const result = await getAcuteMedsReport({
      userId,
      mode: query.mode ?? 'rolling30',
      now: new Date(),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
