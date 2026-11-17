import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { resolveCapturedAt, withIdempotency } from '@/app/api/_helpers/idempotency';
import { logger } from '@/libs/Logger';
import { acuteDoseService } from '@/services/acuteMedications/AcuteDoseService';
import { quickAddService } from '@/services/QuickAddService';
import { CreateQuickMedicationIntakeSchema } from '@/types/Medications';

// POST /api/quick-add/medication-intake
async function handlePost(request: Request) {
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

  try {
    const body = await request.json();
    const input = CreateQuickMedicationIntakeSchema.parse(body);

    const captured = resolveCapturedAt(input.takenAt, new Date(), { maxAgeDays: 7 });
    if ('error' in captured) {
      return NextResponse.json({ error: captured.error, code: 'INVALID_TAKEN_AT' }, { status: 400 });
    }

    const created = await quickAddService.createMedicationIntake({
      userId,
      input: { ...input, takenAt: captured.toISOString() },
    });

    // Same request also writes the acute-dose ledger when asked, so a dose
    // queued offline is one replayable unit instead of two dependent calls.
    let acuteDoseId: string | undefined;
    if (input.recordAcuteDose) {
      try {
        const dose = await acuteDoseService.create(userId, {
          medicationId: created.userMedicationId,
          attackId: created.linkedEpisodeId ?? null,
          takenAt: captured.toISOString(),
          dose: input.dose ?? null,
          unit: input.unit ?? null,
          unitIsCustom: input.unitIsCustom,
        });
        acuteDoseId = dose.doseId;
      } catch (error) {
        logger.warn({ userId, error }, 'Failed to record acute dose alongside intake');
      }
    }
    logger.info(
      { userId, intakeId: created.intakeId, episodeId: created.linkedEpisodeId ?? undefined },
      'Medication intake created (quick-add)',
    );

    return NextResponse.json(
      {
        intakeId: created.intakeId,
        linkedEpisodeId: created.linkedEpisodeId ?? undefined,
        userMedicationId: created.userMedicationId,
        acuteDoseId,
      },
      { status: 201 },
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      // 400, not 500: a queued offline entry with a bad payload must not be retried forever.
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    logger.error({ error, userId }, 'Error creating medication intake (quick-add)');
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 },
    );
  }
}

// Wrapped so entries queued offline can be replayed safely (see _helpers/idempotency).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'quick-add/medication-intake', () => handlePost(request));
}

export const dynamic = 'force-dynamic';
