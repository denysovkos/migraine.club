import type { LocalDateString } from '@/services/localDate';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';
import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { appointmentPrepService } from '@/services/appointmentPrep/AppointmentPrepService';

const DraftPatchSchema = z.object({
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  visitLabel: z.string().trim().max(200).nullable().optional(),
  clinicianName: z.string().trim().max(200).nullable().optional(),
  visitReason: z.string().trim().max(500).nullable().optional(),
  topConcerns: z.array(z.string().trim().max(200)).optional(),
  doctorQuestions: z.array(z.string().trim().max(200)).optional(),
  personalNotes: z.string().trim().max(4000).nullable().optional(),
});

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message);
}

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
  const draft = await appointmentPrepService.getDraft(userId, id);
  if (!draft) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ draft });
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
    const patch = DraftPatchSchema.parse(body);
    const draft = await appointmentPrepService.updateDraft(userId, id, {
      ...patch,
      appointmentDate: patch.appointmentDate as LocalDateString | undefined,
    });
    return NextResponse.json({ draft });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.flatten() },
        { status: 400 },
      );
    }
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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

  try {
    const { id } = await props.params;
    await appointmentPrepService.deleteDraft(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
