import type { LocalDateString } from '@/services/localDate';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';
import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { appointmentPrepService } from '@/services/appointmentPrep/AppointmentPrepService';

const DraftBodySchema = z.object({
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitLabel: z.string().trim().max(200).nullable().optional(),
  clinicianName: z.string().trim().max(200).nullable().optional(),
  visitReason: z.string().trim().max(500).nullable().optional(),
  topConcerns: z.array(z.string().trim().max(200)).default([]),
  doctorQuestions: z.array(z.string().trim().max(200)).default([]),
  personalNotes: z.string().trim().max(4000).nullable().optional(),
  compareWindowDays: z.coerce.number().int().min(1).max(365).optional(),
});

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

  const drafts = await appointmentPrepService.listDrafts(userId);
  return NextResponse.json({ drafts });
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
    const input = DraftBodySchema.parse(body);
    const created = await appointmentPrepService.createDraft(userId, {
      ...input,
      appointmentDate: input.appointmentDate as LocalDateString,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
