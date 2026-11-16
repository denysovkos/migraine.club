import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { logger } from '@/libs/Logger';
import { communityService } from '@/services/CommunityService';
import { CreateCommunityReportSchema } from '@/types/Community';

// POST /api/community/report - create a moderation report for a post or comment
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateCommunityReportSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error creating community report',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await communityService.createReport(userId, parsed.data);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Error creating community report');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
