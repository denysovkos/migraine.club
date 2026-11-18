import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/libs/Logger';
import { EpisodeError } from '@/services/episodes/EpisodeService';

export function parseEpisodeId(id: string): number | null {
  if (!/^\d+$/.test(id)) {
    return null;
  }
  const n = Number.parseInt(id, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function painReadingErrorResponse(error: unknown, action: string) {
  if (error instanceof EpisodeError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'CONSENT_REQUIRED' ? 403 : 400;
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
  }
  logger.error({ error }, `Error ${action} pain reading`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
