import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { preventivePlansService } from '@/services/preventives/PreventivePlansService';
import { UpdatePreventivePlanSchema } from '@/types/Preventives';

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
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
  const plan = await preventivePlansService.getPlanDetail(userId, id);
  if (!plan) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ plan });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
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
    const { id } = await props.params;
    const body = await request.json();
    const patch = UpdatePreventivePlanSchema.parse(body);
    await preventivePlansService.updatePlan({ userId, planId: id, patch });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
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
  await preventivePlansService.deletePlan(userId, id);
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
