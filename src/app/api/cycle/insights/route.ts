import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { cycleService } from '@/services/cycle/CycleService';
import { getUserTimezone } from '@/services/userTimezone';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const timezone = await getUserTimezone(userId);
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const defaultFrom = DateTime.now().setZone(timezone).minus({ days: 89 }).toISODate()!;

  try {
    const insights = await cycleService.getInsights({
      userId,
      from: from ?? defaultFrom,
      to: to ?? today,
    });
    return NextResponse.json(insights);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load cycle insights' }, { status: 400 });
  }
}
