import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const enrollments = await programEnrollmentService.listForUser(userId);
  return NextResponse.json({ enrollments });
}
