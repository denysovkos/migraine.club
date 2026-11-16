import type { CommunityReportSummary } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { moderationService } from '@/services/ModerationService';
import { ResolveReportSchema } from '@/types/Community';

// GET /api/moderation/reports - list open reports (moderators/admins only)
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isMod = await moderationService.isModerator(userId);
    if (!isMod) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const reports = await moderationService.getOpenReports();

    return NextResponse.json<{ reports: CommunityReportSummary[] }>({ reports });
  } catch (error) {
    logger.error({ error }, 'Error fetching moderation reports');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/moderation/reports - resolve a report (moderators/admins only)
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isMod = await moderationService.isModerator(userId);
    if (!isMod) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = ResolveReportSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error resolving report',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const success = await moderationService.resolveReport(userId, parsed.data);

    if (!success) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error resolving report');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
