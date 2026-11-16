import type { CommunityPostDetail, CommunityPostSummary } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';
import { logger } from '@/libs/Logger';
import { communityService } from '@/services/CommunityService';
import {
  CreateCommunityPostSchema,
  ListCommunityPostsQuerySchema,
} from '@/types/Community';

// GET /api/community/posts - list posts for playground feed
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');
    const sortParam = searchParams.get('sort');
    const tagParam = searchParams.get('tag');
    const onlyOwnParam = searchParams.get('onlyOwn');

    const raw = {
      page: pageParam ? Number.parseInt(pageParam, 10) : undefined,
      limit: limitParam ? Number.parseInt(limitParam, 10) : undefined,
      sort: sortParam ?? undefined,
      tag: tagParam ?? undefined,
      onlyOwn: !!onlyOwnParam,
    };

    const parsed = ListCommunityPostsQuerySchema.safeParse(raw);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten() },
        'Validation error listing community posts',
      );
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const posts = await communityService.listPosts(
      userId ?? null,
      parsed.data,
    );

    return NextResponse.json<{ posts: CommunityPostSummary[] }>({ posts });
  } catch (error) {
    logger.error({ error }, 'Error listing community posts');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/community/posts - create a new community post
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateCommunityPostSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error creating community post',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const post = await communityService.createPost(userId, parsed.data);

      return NextResponse.json<CommunityPostDetail>(post, { status: 201 });
    } catch (err) {
      if (
        err instanceof Error
        && err.message === 'EPISODE_NOT_FOUND_OR_FORBIDDEN'
      ) {
        return NextResponse.json(
          { error: 'Episode not found or access denied' },
          { status: 403 },
        );
      }

      logger.error(
        { error: err, userId },
        'Error creating community post',
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.flatten() }, 'Validation error creating post');
      return NextResponse.json(
        { error: 'Validation error', details: error.flatten() },
        { status: 400 },
      );
    }

    logger.error({ error }, 'Unexpected error creating community post');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
