import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { recommendationDismissalService } from '@/services/programs/recommendationDismissalService';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { programId } = await params;
  await recommendationDismissalService.dismiss(userId, programId);
  return NextResponse.json({ ok: true });
}
