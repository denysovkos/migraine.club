import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DailyDiaryError, dailyDiaryService } from '@/services/DailyDiaryService';

export const dynamic = 'force-dynamic';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const QuerySchema = z.object({
  from: Ymd,
  to: Ymd,
});

/**
 * GET /api/diary/overlap?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns local dates that overlap any episode (inclusive window).
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = QuerySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const overlap = await dailyDiaryService.getAttackOverlapDays({
      userId,
      fromLocalDate: query.from as any,
      toLocalDate: query.to as any,
    });

    return NextResponse.json({ overlapDays: [...overlap].sort() });
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
