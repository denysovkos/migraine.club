import type { HiddenContentItem } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { moderationService } from '@/services/ModerationService';
import { UpdateContentVisibilitySchema } from '@/types/Community';

// GET /api/moderation/visibility - list hidden content (moderators/admins only)
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

    const hiddenContent = await moderationService.getHiddenContent();

    return NextResponse.json<{ items: HiddenContentItem[] }>({ items: hiddenContent });
  } catch (error) {
    logger.error({ error }, 'Error fetching hidden content');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/moderation/visibility - update content visibility (moderators/admins only)
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
    const parsed = UpdateContentVisibilitySchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error updating content visibility',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const success = await moderationService.updateContentVisibility(userId, parsed.data);

    if (!success) {
      return NextResponse.json(
        { error: 'Content not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error updating content visibility');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
