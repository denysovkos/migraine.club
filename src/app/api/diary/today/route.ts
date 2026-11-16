import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { DailyDiaryError, dailyDiaryService } from '@/services/DailyDiaryService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/diary/today
 * Returns today's local date (in user's timezone) and the entry (or null).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await dailyDiaryService.getTodayDiaryState(userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DailyDiaryError) {
      const status = error.code === 'NOT_EDITABLE' ? 403 : 400;
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
