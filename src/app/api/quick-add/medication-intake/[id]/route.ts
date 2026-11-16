import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { logger } from '@/libs/Logger';
import { quickAddService } from '@/services/QuickAddService';
import { UpdateMedicationIntakeSchema } from '@/types/Medications';

// DELETE /api/quick-add/medication-intake/:id (Undo)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const ok = await quickAddService.deleteMedicationIntake({ userId, intakeId: id });

  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  logger.info({ userId, intakeId: id }, 'Medication intake deleted (undo)');
  return NextResponse.json({ success: true });
}

// PATCH /api/quick-add/medication-intake/:id (Edit)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const body = await request.json();
  const input = UpdateMedicationIntakeSchema.parse(body);

  const ok = await quickAddService.updateMedicationIntake({ userId, intakeId: id, input });
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  logger.info({ userId, intakeId: id }, 'Medication intake updated');
  return NextResponse.json({ success: true });
}

export const dynamic = 'force-dynamic';
