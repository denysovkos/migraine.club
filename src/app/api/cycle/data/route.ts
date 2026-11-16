import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { cycleService } from '@/services/cycle/CycleService';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await cycleService.deleteAllData(userId);
  return NextResponse.json({ ok: true });
}
