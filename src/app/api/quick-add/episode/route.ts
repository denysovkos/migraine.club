import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { resolveCapturedAt, withIdempotency } from '@/app/api/_helpers/idempotency';
import { computeEpisodeWeatherContext } from '@/app/api/episodes/helpers';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { episodeSchema } from '@/models/Schema';
import { deriveTouchedLocalDatesForEpisode } from '@/services/diary/attackDayDerivation';
import { recomputeDayRowsForDates } from '@/services/diary/recomputeDayRows';
import { getUserTimezone } from '@/services/userTimezone';
import { PainLocation, PainType } from '@/types/Episode';

// POST /api/quick-add/episode
// Creates an "attack" immediately (no picker); user can edit later.
async function handlePost(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasConsent = await hasHealthDataConsent(userId);
  if (!hasConsent) {
    return NextResponse.json(
      {
        error: 'Health data consent required',
        code: 'CONSENT_REQUIRED',
        message: 'You must provide explicit consent for health data processing before logging.',
      },
      { status: 403 },
    );
  }

  const now = new Date();
  const body = await request.json().catch(() => ({}));

  const BodySchema = z.object({
    attackType: z.enum(['migraine', 'headache']).optional(),
    // When provided (YYYY-MM-DD local date in user TZ), we create a finished episode
    // with default duration (1 hour) anchored on that date.
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Optional: true onset time, distinct from log time. Used by acute-med-timing.
    onsetAt: z.string().datetime().optional().nullable(),
    // When the user tapped "start" on their device. Entries queued offline are
    // synced later, and must keep this time rather than the sync time.
    startedAt: z.string().datetime().optional(),
  });
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.issues }, { status: 400 });
  }

  const attackType: 'migraine' | 'headache' = parsed.data.attackType === 'headache' ? 'headache' : 'migraine';
  const localDate = parsed.data.localDate ?? null;
  const onsetAt = parsed.data.onsetAt ? new Date(parsed.data.onsetAt) : null;

  // Historical creation (from diary for past days): create a finished 1-hour episode on that local date.
  // This should not affect any ongoing episode.
  if (localDate) {
    try {
      const timezone = await getUserTimezone(userId);
      const start = DateTime.fromISO(localDate, { zone: timezone }).startOf('day').plus({ hours: 12 });
      const startTime = start.toUTC().toJSDate();
      const endTime = start.plus({ hours: 1 }).toUTC().toJSDate();

      const { weatherPainIndexId, weatherContext } = await computeEpisodeWeatherContext(
        userId,
        startTime,
      );

      const [episode] = await db
        .insert(episodeSchema)
        .values({
          userId,
          startTime,
          onsetAt: onsetAt ?? startTime,
          endTime,
          isOngoing: false,
          attackType,
          // Placeholder values; user can edit later
          intensity: 3,
          painLocation: PainLocation.OTHER,
          painLocationOther: 'unspecified',
          painType: PainType.OTHER,
          painTypeOther: 'unspecified',
          symptoms: [],
          symptomsOther: null,
          medications: [],
          triggers: [],
          protectors: [],
          triggersOther: null,
          notes: null,
          weatherPainIndexId,
          weatherContext,
        })
        .returning({ id: episodeSchema.id });

      if (!episode) {
        return NextResponse.json({ error: 'Failed to create episode' }, { status: 500 });
      }

      logger.info({ userId, episodeId: episode.id, localDate }, 'Episode created (quick-add historical)');

      try {
        const dates = deriveTouchedLocalDatesForEpisode({
          startTime,
          endTime,
          isOngoing: false,
          timezone,
        });
        await recomputeDayRowsForDates({ userId, localDates: [...dates], timezone });
      } catch (e) {
        logger.warn({ userId, error: e }, 'Failed to recompute diary day rows after quick-add historical');
      }

      return NextResponse.json({ episodeId: episode.id }, { status: 201 });
    } catch (e) {
      logger.error({ userId, error: e }, 'Failed to create historical episode');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  const captured = resolveCapturedAt(parsed.data.startedAt, now, { maxAgeDays: 7 });
  if ('error' in captured) {
    return NextResponse.json({ error: captured.error, code: 'INVALID_STARTED_AT' }, { status: 400 });
  }
  const startTime = captured;

  // Enforce: only one ongoing attack at a time.
  const ongoing = await db
    .select({
      id: episodeSchema.id,
      startTime: episodeSchema.startTime,
      endTime: episodeSchema.endTime,
      isOngoing: episodeSchema.isOngoing,
      attackType: episodeSchema.attackType,
    })
    .from(episodeSchema)
    .where(and(eq(episodeSchema.userId, userId), eq(episodeSchema.isOngoing, true)));

  const existing = ongoing[0] ?? null;

  // Upgrade path: ongoing headache -> start migraine (end headache + start migraine)
  if (existing && existing.attackType === 'headache' && attackType === 'migraine') {
    // Try to compute WPI snapshot for this episode start time (non-blocking)
    const { weatherPainIndexId, weatherContext } = await computeEpisodeWeatherContext(
      userId,
      startTime,
    );

    const created = await db.transaction(async (tx) => {
      await tx
        .update(episodeSchema)
        .set({ isOngoing: false, endTime: startTime })
        .where(and(eq(episodeSchema.userId, userId), eq(episodeSchema.id, existing.id)));

      const [ep] = await tx
        .insert(episodeSchema)
        .values({
          userId,
          startTime,
          onsetAt: onsetAt ?? startTime,
          endTime: null,
          isOngoing: true,
          attackType: 'migraine',
          // Placeholder values; user can edit later
          intensity: 3,
          painLocation: PainLocation.OTHER,
          painLocationOther: 'unspecified',
          painType: PainType.OTHER,
          painTypeOther: 'unspecified',
          symptoms: [],
          symptomsOther: null,
          medications: [],
          triggers: [],
          protectors: [],
          triggersOther: null,
          notes: null,
          weatherPainIndexId,
          weatherContext,
        })
        .returning({ id: episodeSchema.id });

      return ep;
    });

    if (!created) {
      return NextResponse.json({ error: 'Failed to create episode' }, { status: 500 });
    }

    logger.info(
      { userId, upgradedFromEpisodeId: existing.id, episodeId: created.id },
      'Episode upgraded (quick-add: headache -> migraine)',
    );

    // Keep day backbone consistent with attack evidence
    try {
      const timezone = await getUserTimezone(userId);
      const dates = new Set<string>();
      for (const d of deriveTouchedLocalDatesForEpisode({
        startTime: existing.startTime,
        endTime: startTime,
        isOngoing: false,
        timezone,
      })) {
        dates.add(d);
      }
      for (const d of deriveTouchedLocalDatesForEpisode({
        startTime,
        endTime: null,
        isOngoing: true,
        timezone,
      })) {
        dates.add(d);
      }
      await recomputeDayRowsForDates({ userId, localDates: [...dates], timezone });
    } catch (e) {
      logger.warn({ userId, error: e }, 'Failed to recompute diary day rows after quick-add upgrade');
    }

    return NextResponse.json({ episodeId: created.id, upgradedFromEpisodeId: existing.id }, { status: 201 });
  }

  if (existing) {
    return NextResponse.json(
      {
        error: 'An attack is already in progress.',
        code: 'ONGOING_EXISTS',
        ongoing: { episodeId: existing.id, attackType: existing.attackType },
      },
      { status: 409 },
    );
  }

  // Try to compute WPI snapshot for this episode start time (non-blocking)
  const { weatherPainIndexId, weatherContext } = await computeEpisodeWeatherContext(userId, startTime);

  const [episode] = await db
    .insert(episodeSchema)
    .values({
      userId,
      startTime,
      onsetAt: onsetAt ?? startTime,
      endTime: null,
      isOngoing: true,
      attackType,
      // Placeholder values; user can edit later
      intensity: 3,
      painLocation: PainLocation.OTHER,
      painLocationOther: 'unspecified',
      painType: PainType.OTHER,
      painTypeOther: 'unspecified',
      symptoms: [],
      symptomsOther: null,
      medications: [],
      triggers: [],
      protectors: [],
      triggersOther: null,
      notes: null,
      weatherPainIndexId,
      weatherContext,
    })
    .returning({ id: episodeSchema.id });

  if (!episode) {
    return NextResponse.json({ error: 'Failed to create episode' }, { status: 500 });
  }

  logger.info({ userId, episodeId: episode.id }, 'Episode created (quick-add)');

  // Keep day backbone consistent with attack evidence
  try {
    const timezone = await getUserTimezone(userId);
    const dates = new Set<string>();
    // New attack touches "today" for sure (even if later edited)
    for (const d of deriveTouchedLocalDatesForEpisode({
      startTime,
      endTime: null,
      isOngoing: true,
      timezone,
    })) {
      dates.add(d);
    }
    await recomputeDayRowsForDates({ userId, localDates: [...dates], timezone });
  } catch (e) {
    logger.warn({ userId, error: e }, 'Failed to recompute diary day rows after quick-add');
  }

  return NextResponse.json({ episodeId: episode.id }, { status: 201 });
}

// Wrapped so entries queued offline can be replayed safely (see _helpers/idempotency).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'quick-add/episode', () => handlePost(request));
}

export const dynamic = 'force-dynamic';
