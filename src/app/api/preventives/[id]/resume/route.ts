import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { preventivePlansService } from '@/services/preventives/PreventivePlansService';

export async function POST(_: Request, props: { params: Promise<{ id: string }> }) {
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

  const { id } = await props.params;
  await preventivePlansService.setStatus({ userId, planId: id, nextStatus: 'active' });
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
