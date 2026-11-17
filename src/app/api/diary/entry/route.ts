import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { DailyDiaryError, dailyDiaryService } from '@/services/DailyDiaryService';

export const dynamic = 'force-dynamic';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PatchSchema = z.object({
  dayType: z.enum(['headache_free', 'headache_day', 'migraine_day']).optional(),
  impact: z.number().int().min(0).max(4).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  bedTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  wakeTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

const BodySchema = z.object({
  localDate: Ymd,
  patch: PatchSchema,
});

/**
 * PUT /api/diary/entry
 * Body: { localDate: YYYY-MM-DD, patch: { ... } }
 */
async function handlePut(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = BodySchema.parse(await request.json());
    const saved = await dailyDiaryService.upsertDailyDiaryEntry({
      userId,
      localDate: body.localDate as any,
      patch: body.patch as any,
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    if (error instanceof DailyDiaryError) {
      const status = error.code === 'NOT_EDITABLE' ? 403 : 400;
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Wrapped so entries queued offline can be replayed safely (see _helpers/idempotency).
export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'diary/entry', () => handlePut(request));
}
