import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { preventivePlansService } from '@/services/preventives/PreventivePlansService';
import { CreatePreventivePlanSchema } from '@/types/Preventives';

export async function GET() {
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

  const plans = await preventivePlansService.listPlans(userId);
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
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
    const body = await request.json();
    const input = CreatePreventivePlanSchema.parse(body);
    const created = await preventivePlansService.createPlan(userId, input);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
