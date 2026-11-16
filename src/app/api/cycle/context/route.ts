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
  const date = searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  try {
    const context = await cycleService.getContextForDate({ userId, date });
    return NextResponse.json(context);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load context' }, { status: 400 });
  }
}
