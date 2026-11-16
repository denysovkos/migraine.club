import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { collectSignals } from '@/services/programs/collectSignals';
import { getProgramDefinitions } from '@/services/programs/programDefinitions';
import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';
import { recommendationDismissalService } from '@/services/programs/recommendationDismissalService';
import { rankRecommendations } from '@/services/programs/recommendationEngine';
import { getUserTimezone } from '@/services/userTimezone';

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

  const timezone = await getUserTimezone(userId);
  const today = DateTime.now().setZone(timezone).toISODate()!;

  const [signals, enrollments, dismissedIds] = await Promise.all([
    collectSignals({ userId, today, timezone }),
    programEnrollmentService.listForUser(userId),
    recommendationDismissalService.listActiveDismissals(userId),
  ]);

  const programs = getProgramDefinitions().map(d => ({
    id: d.frontmatter.id,
    triggers: d.frontmatter.recommendationTriggers,
  }));

  const ranked = rankRecommendations({
    programs,
    enrolledIds: enrollments.filter(e => e.status === 'active').map(e => e.programId),
    dismissedIds,
    signals,
  });

  const titlesById = new Map(getProgramDefinitions().map(d => [d.frontmatter.id, d.frontmatter.title]));
  return NextResponse.json({
    recommendations: ranked.map(r => ({ ...r, title: titlesById.get(r.id) ?? r.id })),
  });
}
