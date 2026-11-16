import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { logger } from '@/libs/Logger';
import { quickAddService } from '@/services/QuickAddService';
import { CreateQuickMedicationIntakeSchema } from '@/types/Medications';

// POST /api/quick-add/medication-intake
export async function POST(request: Request) {
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

    const created = await quickAddService.createMedicationIntake({ userId, input });
    logger.info(
      { userId, intakeId: created.intakeId, episodeId: created.linkedEpisodeId ?? undefined },
      'Medication intake created (quick-add)',
    );

    return NextResponse.json(
      {
        intakeId: created.intakeId,
        linkedEpisodeId: created.linkedEpisodeId ?? undefined,
        userMedicationId: created.userMedicationId,
      },
      { status: 201 },
    );
  } catch (error: any) {
    logger.error({ error, userId }, 'Error creating medication intake (quick-add)');
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
