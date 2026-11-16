import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

const Body = z.object({ enrollmentId: z.number().int() });

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  try {
    const { enrollmentId } = Body.parse(await request.json());
    const result = await programEnrollmentService.end({ userId, enrollmentId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal' }, { status: 400 });
  }
}
