import type { VoteOnPostInput } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { communityService } from '@/services/CommunityService';
import { VoteOnPostSchema } from '@/types/Community';

// POST /api/community/posts/:id/vote - upvote/downvote/remove vote
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = VoteOnPostSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error voting on community post',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await communityService.voteOnPost(userId, id, parsed.data as VoteOnPostInput);

    if (!result) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ error }, 'Error voting on community post');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
