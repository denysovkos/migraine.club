import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DailyDiaryError, dailyDiaryService } from '@/services/DailyDiaryService';

export const dynamic = 'force-dynamic';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/diary/day?date=YYYY-MM-DD
 * Returns day entry (or null), attacks touching the day, and medication intakes for that local date.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const date = Ymd.parse(searchParams.get('date'));
    const result = await dailyDiaryService.getDayDetail({ userId, localDate: date as any });
    return NextResponse.json(result);
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
