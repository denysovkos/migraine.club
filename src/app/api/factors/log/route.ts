import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { logger } from '@/libs/Logger';
import { FactorError, factorService, LogFactorSchema } from '@/services/factors/FactorService';

// POST /api/factors/log - create (or reuse) a factor and log an event for the current user
async function handlePost(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const input = LogFactorSchema.parse(await request.json());

  try {
    const result = await factorService.log(userId, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FactorError) {
      return NextResponse.json(
        { error: 'Health data consent required', code: 'CONSENT_REQUIRED' },
        { status: 403 },
      );
    }

    logger.error({ error, userId }, 'Failed to log factor event');
    const pgCode = (error as any)?.code;
    if (pgCode === '42703') {
      return NextResponse.json(
        { error: 'Database schema is out of date. Please run migrations (npm run db:migrate).' },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Wrapped so entries queued offline can be replayed safely (see _helpers/idempotency).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'factors/log', () => handlePost(request));
}

export const dynamic = 'force-dynamic';
