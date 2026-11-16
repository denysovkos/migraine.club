import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { logger } from '@/libs/Logger';
import {
  AcuteDoseError,
  AcuteDoseSchema,
  acuteDoseService,
} from '@/services/acuteMedications/AcuteDoseService';

async function handlePost(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const input = AcuteDoseSchema.parse(await request.json());
    const result = await acuteDoseService.create(userId, input);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof AcuteDoseError) {
      if (error.code === 'CONSENT_REQUIRED') {
        return NextResponse.json(
          { error: 'Health data consent required', code: 'CONSENT_REQUIRED' },
          { status: 403 },
        );
      }
      if (error.code === 'MEDICATION_NOT_FOUND') {
        return NextResponse.json({ error: 'Medication not found' }, { status: 404 });
      }
      // ATTACK_NOT_FOUND kept on its historical 500 path; see PR notes.
    }

    logger.error({ error, userId }, 'Failed to log acute dose');
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

// Wrapped so entries queued offline can be replayed safely (see _helpers/idempotency).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'acute-doses', () => handlePost(request));
}

export const dynamic = 'force-dynamic';
