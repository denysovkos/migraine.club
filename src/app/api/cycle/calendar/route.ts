import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { cycleService } from '@/services/cycle/CycleService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 });
  }

  try {
    const result = await cycleService.getCalendarRange({ userId, from, to });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load calendar' }, { status: 400 });
  }
}
