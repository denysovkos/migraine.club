import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { logger } from '@/libs/Logger';
import { EpisodeError } from '@/services/episodes/EpisodeService';
import { reliefSessionService } from '@/services/relief/ReliefSessionService';

function errorResponse(error: unknown, action: string) {
  if (error instanceof EpisodeError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'CONSENT_REQUIRED' ? 403 : 400;
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
  }
  logger.error({ error }, `Error ${action} relief session`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// GET /api/relief-sessions[?episodeId=N] - the user's relief sessions, newest first
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = new URL(request.url).searchParams.get('episodeId');
  let episodeId: number | undefined;
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
      return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
    }
    episodeId = Number(raw);
  }
  try {
    const sessions = await reliefSessionService.list(userId, { episodeId });
    return NextResponse.json({ sessions });
  } catch (error) {
    return errorResponse(error, 'listing');
  }
}

// POST /api/relief-sessions - record one finished or stopped session.
// Wrapped so sessions recorded offline (attack mode) are replayed at most once.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'relief-sessions', async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    try {
      const session = await reliefSessionService.add(userId, body);
      return NextResponse.json({ session }, { status: 201 });
    } catch (error) {
      return errorResponse(error, 'creating');
    }
  });
}
