import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/libs/Logger';
import { EpisodeError, episodeService } from '@/services/episodes/EpisodeService';

/** Map a service-layer error onto the HTTP contract this route has always had. */
function episodeErrorResponse(error: EpisodeError) {
  switch (error.code) {
    case 'CONSENT_REQUIRED':
      return NextResponse.json(
        {
          error: 'Health data consent required',
          code: 'CONSENT_REQUIRED',
          message: error.message,
        },
        { status: 403 },
      );
    case 'ONGOING_EXISTS':
      return NextResponse.json(
        {
          error: error.message,
          code: 'ONGOING_EXISTS',
          ...(error.details as Record<string, unknown>),
        },
        { status: 409 },
      );
    default:
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
}

// POST /api/episodes - Create a new episode
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const episode = await episodeService.create(userId, await request.json());
    return NextResponse.json(episode, { status: 201 });
  } catch (error) {
    if (error instanceof EpisodeError) {
      return episodeErrorResponse(error);
    }

    if (error instanceof z.ZodError) {
      logger.warn({ error: error.issues }, 'Validation error creating episode');
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }

    logger.error({ error }, 'Error creating episode');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// GET /api/episodes - List episodes for the current user
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const result = await episodeService.list(userId, {
      page: Number.parseInt(searchParams.get('page') ?? '1', 10),
      limit: Number.parseInt(searchParams.get('limit') ?? '20', 10),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ error }, 'Error fetching episodes');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
