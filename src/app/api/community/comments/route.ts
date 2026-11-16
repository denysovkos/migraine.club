import type { CommunityComment } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { communityService } from '@/services/CommunityService';
import {
  CreateCommunityCommentSchema,
} from '@/types/Community';

// POST /api/community/comments - create a new comment (root or reply)
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateCommunityCommentSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error creating community comment',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const comment = await communityService.createComment(userId, parsed.data);

    if (!comment) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json<CommunityComment>(comment, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Error creating community comment');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
