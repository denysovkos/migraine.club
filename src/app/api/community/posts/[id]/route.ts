import type { CommunityPostDetail } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { communityService } from '@/services/CommunityService';

// GET /api/community/posts/:id - get a single post with comments
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    // Basic UUID sanity check; CommunityService will enforce visibility
    if (!id) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const post = await communityService.getPostWithComments(userId, id);

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json<CommunityPostDetail>(post);
  } catch (error) {
    logger.error({ error }, 'Error fetching community post');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
