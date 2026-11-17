import type { Episode } from '@/types/Episode';
import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { episodeSchema, medicationIntakesSchema, medicationsCatalogSchema, userMedicationsSchema } from '@/models/Schema';
import { getAttackTreatmentModel } from '@/services/acuteMedications/attackTreatmentModel';
import { deriveTouchedLocalDatesForEpisode } from '@/services/diary/attackDayDerivation';
import { recomputeDayRowsForDates } from '@/services/diary/recomputeDayRows';
import {
  asPainLocation,
  asPainType,
  asProtectors,
  asSymptoms,
  asTriggers,
  EpisodeError,
  episodeService,
} from '@/services/episodes/EpisodeService';
import { getUserTimezone } from '@/services/userTimezone';

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function labelForUserMedication(row: { canonicalName: string | null; customName: string | null }): string {
  const raw = row.customName ?? row.canonicalName ?? 'Medication';
  return normalizeName(raw);
}

/** Intakes joined for display on the episode detail payload. */
async function loadMedicationIntakes(userId: string, episodeId: number) {
  const rows = await db
    .select({
      id: medicationIntakesSchema.id,
      takenAt: medicationIntakesSchema.takenAt,
      dose: medicationIntakesSchema.dose,
      unit: medicationIntakesSchema.unit,
      unitIsCustom: medicationIntakesSchema.unitIsCustom,
      medicationName: medicationIntakesSchema.medicationName,
      customName: userMedicationsSchema.customName,
      canonicalName: medicationsCatalogSchema.canonicalName,
    })
    .from(medicationIntakesSchema)
    .leftJoin(
      userMedicationsSchema,
      eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id),
    )
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .where(
      and(
        eq(medicationIntakesSchema.userId, userId),
        eq(medicationIntakesSchema.episodeId, episodeId),
      ),
    )
    .orderBy(desc(medicationIntakesSchema.takenAt));

  return rows.map(mi => ({
    id: mi.id,
    takenAt: mi.takenAt.toISOString(),
    label: mi.medicationName ?? labelForUserMedication({ canonicalName: mi.canonicalName ?? null, customName: mi.customName ?? null }),
    dose: mi.dose ?? null,
    unit: mi.unit ?? null,
    unitIsCustom: mi.unitIsCustom,
  }));
}

function toDetailPayload(
  episode: typeof episodeSchema.$inferSelect,
  medicationIntakes: Awaited<ReturnType<typeof loadMedicationIntakes>>,
  attackTreatment: Awaited<ReturnType<typeof getAttackTreatmentModel>>,
) {
  return {
    id: episode.id,
    userId: episode.userId,
    attackType: episode.attackType,
    startTime: episode.startTime,
    onsetAt: episode.onsetAt ?? null,
    endTime: episode.endTime,
    isOngoing: episode.isOngoing,
    intensity: episode.intensity,
    painLocation: asPainLocation(episode.painLocation),
    painLocationOther: episode.painLocationOther,
    painType: asPainType(episode.painType),
    painTypeOther: episode.painTypeOther,
    symptoms: asSymptoms(episode.symptoms),
    symptomsOther: episode.symptomsOther,
    medicationIntakes,
    attackTreatment,
    triggers: asTriggers(episode.triggers),
    protectors: asProtectors(episode.protectors),
    triggersOther: episode.triggersOther,
    notes: episode.notes,
    weatherPainIndexId: episode.weatherPainIndexId,
    weatherContext: episode.weatherContext,
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt,
  } satisfies Episode;
}

// GET /api/episodes/:id - Get a single episode
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
    const episodeId = Number.parseInt(id, 10);

    if (Number.isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
    }

    const episode = await episodeService.getById(userId, episodeId);

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const medicationIntakes = await loadMedicationIntakes(userId, episodeId);
    const attackTreatment = await getAttackTreatmentModel(episodeId);

    return NextResponse.json(toDetailPayload(episode, medicationIntakes, attackTreatment));
  } catch (error) {
    // Helpful hint when code is ahead of DB migrations (e.g. missing columns after schema changes)
    const pgCode = (error as any)?.code;
    if (pgCode === '42703') {
      logger.error({ error }, 'Error fetching episode (DB schema mismatch: missing column). Run migrations (npm run db:migrate).');
      return NextResponse.json(
        { error: 'Database schema is out of date. Please run migrations (npm run db:migrate).' },
        { status: 500 },
      );
    }
    logger.error({ error }, 'Error fetching episode');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// PATCH /api/episodes/:id - Update an episode
// Wrapped so edits queued offline (e.g. "end attack") can be replayed safely.
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'episodes/:id', () => handlePatch(request, ctx));
}

async function handlePatch(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const episodeId = Number.parseInt(id, 10);

    if (Number.isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
    }

    const updated = await episodeService.update(userId, episodeId, await request.json());

    // Re-fetch intakes for this episode so the client sees them immediately without refresh.
    const medicationIntakes = await loadMedicationIntakes(userId, episodeId);
    const attackTreatment = await getAttackTreatmentModel(episodeId);

    return NextResponse.json(toDetailPayload(updated, medicationIntakes, attackTreatment));
  } catch (error) {
    if (error instanceof EpisodeError) {
      const status = error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'NOT_EDITABLE' ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    if (error instanceof z.ZodError) {
      logger.warn({ error: error.issues }, 'Validation error updating episode');
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }

    logger.error({ error }, 'Error updating episode');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// DELETE /api/episodes/:id - Delete an episode
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const episodeId = Number.parseInt(id, 10);

    if (Number.isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
    }

    const existing = await episodeService.getById(userId, episodeId);

    if (!existing) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Capture touched dates before delete (for correct downgrades)
    let timezone: string | null = null;
    let touchedDates: string[] = [];
    try {
      timezone = await getUserTimezone(userId);
      touchedDates = [...deriveTouchedLocalDatesForEpisode({
        startTime: existing.startTime,
        endTime: existing.endTime,
        isOngoing: existing.isOngoing,
        timezone,
      })];
    } catch {
      // ignore
    }

    await db
      .delete(episodeSchema)
      .where(
        and(
          eq(episodeSchema.id, episodeId),
          eq(episodeSchema.userId, userId),
        ),
      );

    logger.info({ episodeId, userId }, 'Episode deleted');

    if (timezone && touchedDates.length > 0) {
      try {
        await recomputeDayRowsForDates({ userId, localDates: touchedDates, timezone });
      } catch (e) {
        logger.warn({ userId, episodeId, error: e }, 'Failed to recompute diary day rows after episode delete');
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Error deleting episode');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
