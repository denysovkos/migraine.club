import type { Episode } from '@/types/Episode';
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';

import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { episodeSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// GET /api/episodes/recent - Get recent episodes with weather context
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 3;

    // Validate limit parameter
    if (Number.isNaN(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        { error: 'Invalid limit parameter. Must be between 1 and 50.' },
        { status: 400 },
      );
    }

    // Fetch recent episodes
    const episodes = await db
      .select()
      .from(episodeSchema)
      .where(eq(episodeSchema.userId, userId))
      .orderBy(desc(episodeSchema.startTime))
      .limit(limit);

    // Map to Episode type with weather context (legacy episode.medications is intentionally omitted)
    const mappedEpisodes = episodes.map(episode => ({
      id: episode.id,
      userId: episode.userId,
      attackType: episode.attackType,
      startTime: episode.startTime,
      endTime: episode.endTime,
      isOngoing: episode.isOngoing,
      intensity: episode.intensity,
      painLocation: episode.painLocation,
      painLocationOther: episode.painLocationOther,
      painType: episode.painType,
      painTypeOther: episode.painTypeOther,
      symptoms: episode.symptoms,
      symptomsOther: episode.symptomsOther,
      medicationIntakes: [],
      triggers: episode.triggers,
      protectors: episode.protectors,
      triggersOther: episode.triggersOther,
      notes: episode.notes,
      weatherPainIndexId: episode.weatherPainIndexId,
      weatherContext: episode.weatherContext,
      createdAt: episode.createdAt,
      updatedAt: episode.updatedAt,
    }));

    return NextResponse.json({
      episodes: mappedEpisodes as (Episode & {
        weatherPainIndexId?: string | null;
        weatherContext?: Record<string, unknown> | null;
      })[],
    });
  } catch (error) {
    const pgCode = (error as any)?.code;
    if (pgCode === '42703') {
      logger.error(
        { error },
        'Error fetching recent episodes (DB schema mismatch: missing column). Run migrations (npm run db:migrate).',
      );
      return NextResponse.json(
        { error: 'Database schema is out of date. Please run migrations (npm run db:migrate).' },
        { status: 500 },
      );
    }
    logger.error({ error }, 'Error fetching recent episodes');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
