import type {
  Episode,
  PainLocationType,
  PainTypeType,
  ProtectorType,
  SymptomType,
  TriggerType,
} from '@/types/Episode';

import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { computeEpisodeWeatherContext } from '@/app/api/episodes/helpers';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { episodeSchema, userConsentSchema } from '@/models/Schema';
import { deriveTouchedLocalDatesForEpisode } from '@/services/diary/attackDayDerivation';
import { recomputeDayRowsForDates } from '@/services/diary/recomputeDayRows';
import { insightsCacheStore } from '@/services/insights/InsightsCacheStore';
import { isEditableLocalDate, toLocalDateString } from '@/services/localDate';
import { recordAcuteAdherenceForAttack } from '@/services/programs/recordAcuteAdherence';
import { getUserTimezone } from '@/services/userTimezone';
import {
  CreateEpisodeSchema,
  PainLocation,
  PainType,
  Protector,
  Symptom,
  Trigger,
  UpdateEpisodeSchema,
} from '@/types/Episode';

export type EpisodeErrorCode
  = | 'CONSENT_REQUIRED'
    | 'ONGOING_EXISTS'
    | 'NOT_FOUND'
    | 'NOT_EDITABLE'
    | 'VALIDATION_ERROR';

export class EpisodeError extends Error {
  code: EpisodeErrorCode;
  details?: unknown;
  constructor(code: EpisodeErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function asPainLocation(v: string): PainLocationType {
  return (Object.values(PainLocation) as string[]).includes(v)
    ? (v as PainLocationType)
    : PainLocation.OTHER;
}

export function asPainType(v: string): PainTypeType {
  return (Object.values(PainType) as string[]).includes(v)
    ? (v as PainTypeType)
    : PainType.OTHER;
}

export function asSymptoms(v: string[]): SymptomType[] {
  const allowed = new Set(Object.values(Symptom) as string[]);
  return v.filter(x => allowed.has(x)) as SymptomType[];
}

export function asTriggers(v: string[]): TriggerType[] {
  const allowed = new Set(Object.values(Trigger) as string[]);
  return v.filter(x => allowed.has(x)) as TriggerType[];
}

export function asProtectors(v: string[]): ProtectorType[] {
  const allowed = new Set(Object.values(Protector) as string[]);
  return v.filter(x => allowed.has(x)) as ProtectorType[];
}

type EpisodeRow = typeof episodeSchema.$inferSelect;

/** Shape returned by the list/create endpoints (no medication intakes joined). */
export function toEpisodeDTO(ep: EpisodeRow): Episode {
  return {
    id: ep.id,
    userId: ep.userId,
    attackType: ep.attackType,
    startTime: ep.startTime,
    onsetAt: ep.onsetAt ?? null,
    endTime: ep.endTime,
    isOngoing: ep.isOngoing,
    intensity: ep.intensity,
    painLocation: asPainLocation(ep.painLocation),
    painLocationOther: ep.painLocationOther,
    painType: asPainType(ep.painType),
    painTypeOther: ep.painTypeOther,
    symptoms: asSymptoms(ep.symptoms),
    symptomsOther: ep.symptomsOther,
    medicationIntakes: [],
    triggers: asTriggers(ep.triggers),
    protectors: asProtectors(ep.protectors),
    triggersOther: ep.triggersOther,
    notes: ep.notes,
    weatherPainIndexId: ep.weatherPainIndexId,
    weatherContext: ep.weatherContext,
    createdAt: ep.createdAt,
    updatedAt: ep.updatedAt,
  } satisfies Episode;
}

export const QuickCreateEpisodeSchema = z.object({
  mode: z.literal('quick'),
  intensity: z.number().int().min(1).max(5),
  attackType: z.enum(['migraine', 'headache']).optional(),
  startTime: z.string().datetime().optional().nullable(),
  onsetAt: z.string().datetime().optional().nullable(),
  isOngoing: z.boolean().optional(),
});

export type ListEpisodesInput = {
  page?: number;
  limit?: number;
  from?: string | null;
  to?: string | null;
};

export type ListEpisodesResult = {
  episodes: Episode[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export class EpisodeService {
  /**
   * Health-data consent gate. Callers that write episode data must pass it;
   * previously duplicated inline in each route handler.
   */
  async hasHealthDataConsent(userId: string): Promise<boolean> {
    const consent = await db
      .select()
      .from(userConsentSchema)
      .where(
        and(
          eq(userConsentSchema.userId, userId),
          eq(userConsentSchema.consentType, 'health_data'),
          isNull(userConsentSchema.withdrawnAt),
        ),
      )
      .limit(1);

    return consent.length > 0;
  }

  private async requireConsent(userId: string): Promise<void> {
    if (!(await this.hasHealthDataConsent(userId))) {
      throw new EpisodeError(
        'CONSENT_REQUIRED',
        'You must provide explicit consent for health data processing before logging episodes.',
      );
    }
  }

  async getOngoing(userId: string): Promise<{ id: number; attackType: string; startTime: Date } | null> {
    const [existing] = await db
      .select({
        id: episodeSchema.id,
        attackType: episodeSchema.attackType,
        startTime: episodeSchema.startTime,
      })
      .from(episodeSchema)
      .where(and(eq(episodeSchema.userId, userId), eq(episodeSchema.isOngoing, true)))
      .limit(1);

    return existing ?? null;
  }

  /**
   * Enforce "one ongoing attack at a time", with the documented upgrade path:
   * an ongoing headache is ended when a migraine starts.
   */
  private async resolveOngoingConflict(args: {
    userId: string;
    attackType: 'migraine' | 'headache';
    startTime: Date;
  }): Promise<void> {
    const existing = await this.getOngoing(args.userId);
    if (!existing) {
      return;
    }

    if (existing.attackType === 'headache' && args.attackType === 'migraine') {
      await db
        .update(episodeSchema)
        .set({ isOngoing: false, endTime: args.startTime })
        .where(and(eq(episodeSchema.userId, args.userId), eq(episodeSchema.id, existing.id)));
      return;
    }

    throw new EpisodeError('ONGOING_EXISTS', 'An attack is already in progress.', {
      ongoing: { episodeId: existing.id, attackType: existing.attackType },
    });
  }

  /** Best-effort: keep the diary day backbone and insights cache consistent. */
  private async refreshDerived(args: {
    userId: string;
    episode: EpisodeRow;
    context: string;
    previous?: EpisodeRow;
  }): Promise<void> {
    try {
      const timezone = await getUserTimezone(args.userId);
      const dates = new Set<string>(
        deriveTouchedLocalDatesForEpisode({
          startTime: args.episode.startTime,
          endTime: args.episode.endTime,
          isOngoing: args.episode.isOngoing,
          timezone,
        }),
      );
      if (args.previous) {
        for (const d of deriveTouchedLocalDatesForEpisode({
          startTime: args.previous.startTime,
          endTime: args.previous.endTime,
          isOngoing: args.previous.isOngoing,
          timezone,
        })) {
          dates.add(d);
        }
      }
      await recomputeDayRowsForDates({ userId: args.userId, localDates: [...dates], timezone });
    } catch (e) {
      logger.warn({ userId: args.userId, error: e }, `Failed to recompute diary day rows after ${args.context}`);
    }

    try {
      await insightsCacheStore.markStaleForUser(args.userId);
    } catch (e) {
      logger.warn({ userId: args.userId, error: e }, `Failed to mark insights cache stale after ${args.context}`);
    }
  }

  /**
   * Create an episode. Accepts both the quick-add body (`mode: 'quick'`) and the
   * full body, dispatching on the discriminator so every caller shares one
   * validation path.
   */
  async create(userId: string, body: unknown): Promise<Episode> {
    await this.requireConsent(userId);

    const isQuick = (body as any)?.mode === 'quick';
    return isQuick ? this.createQuick(userId, body) : this.createFull(userId, body);
  }

  private async createQuick(userId: string, body: unknown): Promise<Episode> {
    const quick = QuickCreateEpisodeSchema.parse(body);

    const startTime = quick.startTime ? new Date(quick.startTime) : new Date();
    const onsetAt = quick.onsetAt ? new Date(quick.onsetAt) : startTime;
    const isOngoing = quick.isOngoing ?? true;
    const attackType: 'migraine' | 'headache' = quick.attackType ?? 'migraine';

    if (isOngoing) {
      await this.resolveOngoingConflict({ userId, attackType, startTime });
    }

    const { weatherPainIndexId, weatherContext } = await computeEpisodeWeatherContext(
      userId,
      startTime,
    );

    const [episode] = await db
      .insert(episodeSchema)
      .values({
        userId,
        startTime,
        onsetAt,
        endTime: null,
        isOngoing,
        attackType,
        intensity: quick.intensity,
        // Placeholders for required fields; encourage user to enrich later
        painLocation: PainLocation.OTHER,
        painLocationOther: 'unspecified',
        painType: PainType.OTHER,
        painTypeOther: 'unspecified',
        symptoms: [],
        symptomsOther: null,
        // Legacy episode.medications is deprecated; do not write to it.
        medications: [],
        triggers: [],
        protectors: [],
        triggersOther: null,
        notes: null,
        weatherPainIndexId,
        weatherContext,
      })
      .returning();

    if (!episode) {
      throw new Error('Failed to create episode');
    }

    await this.refreshDerived({ userId, episode, context: 'episode quick-create' });

    logger.info({ episodeId: episode.id, userId, mode: 'quick' }, 'Episode created (quick)');
    return toEpisodeDTO(episode);
  }

  private async createFull(userId: string, body: unknown): Promise<Episode> {
    const validatedData = CreateEpisodeSchema.parse(body);

    const startTime = validatedData.startTime ? new Date(validatedData.startTime) : new Date();
    const onsetAt = validatedData.onsetAt ? new Date(validatedData.onsetAt) : startTime;

    const isOngoing = validatedData.isOngoing ?? false;
    const endTime = isOngoing
      ? null
      : validatedData.endTime
        ? new Date(validatedData.endTime)
        : null;

    const attackType: 'migraine' | 'headache'
      = (validatedData as any).attackType === 'headache' ? 'headache' : 'migraine';

    if (isOngoing) {
      await this.resolveOngoingConflict({ userId, attackType, startTime });
    }

    const { weatherPainIndexId, weatherContext } = await computeEpisodeWeatherContext(
      userId,
      startTime,
    );

    const episode = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(episodeSchema)
        .values({
          userId,
          startTime,
          onsetAt,
          endTime,
          isOngoing,
          attackType,
          intensity: validatedData.intensity,
          painLocation: validatedData.painLocation,
          painLocationOther: validatedData.painLocationOther ?? null,
          painType: validatedData.painType,
          painTypeOther: validatedData.painTypeOther ?? null,
          symptoms: validatedData.symptoms,
          symptomsOther: validatedData.symptomsOther ?? null,
          // Legacy episode.medications is deprecated; do not write to it.
          medications: [],
          triggers: validatedData.triggers,
          protectors: validatedData.protectors,
          triggersOther: validatedData.triggersOther ?? null,
          notes: validatedData.notes ?? null,
          weatherPainIndexId,
          weatherContext,
        })
        .returning();

      if (!created) {
        throw new Error('Failed to create episode');
      }
      return created;
    });

    logger.info({ episodeId: episode.id, userId, hasWpiContext: !!weatherContext }, 'Episode created');

    await this.refreshDerived({ userId, episode, context: 'episode create' });

    return toEpisodeDTO(episode);
  }

  async getById(userId: string, episodeId: number): Promise<EpisodeRow | null> {
    const [episode] = await db
      .select()
      .from(episodeSchema)
      .where(and(eq(episodeSchema.id, episodeId), eq(episodeSchema.userId, userId)))
      .limit(1);

    return episode ?? null;
  }

  /**
   * Patch an episode. Owns the 30-day backfill window, the ongoing/endTime
   * consistency rules, and the derived-data refresh.
   */
  async update(userId: string, episodeId: number, body: unknown): Promise<EpisodeRow> {
    const existing = await this.getById(userId, episodeId);
    if (!existing) {
      throw new EpisodeError('NOT_FOUND', 'Episode not found');
    }

    const validatedData = UpdateEpisodeSchema.parse(body);

    // Editing/backfill policy:
    // - Historical timestamp/type edits only allowed within last 30 days (user timezone).
    // - Ending an ongoing episode "now" is allowed regardless of original start date.
    // - Descriptive fields can be edited outside the window.
    const timezone = await getUserTimezone(userId);
    const touchesTimelineOrType
      = validatedData.startTime !== undefined
        || validatedData.endTime !== undefined
        || validatedData.isOngoing !== undefined
        || (validatedData as any).attackType !== undefined;

    if (touchesTimelineOrType) {
      const editAnchorTime = !existing.isOngoing && existing.endTime
        ? existing.endTime
        : existing.startTime;
      const editAnchorLocalDate = toLocalDateString(editAnchorTime, timezone);
      if (!isEditableLocalDate(editAnchorLocalDate as any, new Date(), timezone)) {
        throw new EpisodeError(
          'NOT_EDITABLE',
          'This attack is outside the editing window (last 30 days).',
        );
      }
    }

    const updateData: Partial<typeof episodeSchema.$inferInsert> = {};

    // endNow takes precedence over any provided endTime.
    if (validatedData.endNow === true) {
      updateData.isOngoing = false;
      updateData.endTime = new Date();
    }

    if (validatedData.startTime !== undefined) {
      updateData.startTime = new Date(validatedData.startTime);
    }

    if (validatedData.onsetAt !== undefined) {
      updateData.onsetAt = validatedData.onsetAt ? new Date(validatedData.onsetAt) : null;
    }

    if (validatedData.isOngoing !== undefined && validatedData.endNow !== true) {
      updateData.isOngoing = validatedData.isOngoing;
      if (validatedData.isOngoing) {
        updateData.endTime = null;
      } else if (validatedData.endTime !== undefined) {
        updateData.endTime = validatedData.endTime ? new Date(validatedData.endTime) : null;
      }
    } else if (validatedData.endTime !== undefined && validatedData.endNow !== true) {
      if (existing.isOngoing) {
        throw new EpisodeError('VALIDATION_ERROR', 'Cannot set endTime when episode is ongoing');
      }
      updateData.endTime = validatedData.endTime ? new Date(validatedData.endTime) : null;
    }

    const finalStartTime = updateData.startTime ?? existing.startTime;
    const finalEndTime = updateData.endTime ?? existing.endTime;
    const finalIsOngoing = updateData.isOngoing ?? existing.isOngoing;

    if (!finalIsOngoing && finalEndTime && finalEndTime < finalStartTime) {
      throw new EpisodeError('VALIDATION_ERROR', 'endTime must be >= startTime');
    }

    if (validatedData.intensity !== undefined) {
      updateData.intensity = validatedData.intensity;
    }
    if (validatedData.painLocation !== undefined) {
      updateData.painLocation = validatedData.painLocation;
    }
    if (validatedData.painLocationOther !== undefined) {
      updateData.painLocationOther = validatedData.painLocationOther ?? null;
    }
    if (validatedData.painType !== undefined) {
      updateData.painType = validatedData.painType;
    }
    if (validatedData.painTypeOther !== undefined) {
      updateData.painTypeOther = validatedData.painTypeOther ?? null;
    }
    if (validatedData.symptoms !== undefined) {
      updateData.symptoms = validatedData.symptoms;
    }
    if (validatedData.symptomsOther !== undefined) {
      updateData.symptomsOther = validatedData.symptomsOther ?? null;
    }
    if (validatedData.triggers !== undefined) {
      updateData.triggers = validatedData.triggers;
    }
    if (validatedData.protectors !== undefined) {
      updateData.protectors = validatedData.protectors;
    }
    if (validatedData.triggersOther !== undefined) {
      updateData.triggersOther = validatedData.triggersOther ?? null;
    }
    if (validatedData.notes !== undefined) {
      updateData.notes = validatedData.notes ?? null;
    }

    const maybeAttackType = (validatedData as any).attackType as 'migraine' | 'headache' | undefined;
    if (maybeAttackType !== undefined) {
      updateData.attackType = maybeAttackType;
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(episodeSchema)
        .set(updateData)
        .where(and(eq(episodeSchema.id, episodeId), eq(episodeSchema.userId, userId)))
        .returning();

      if (!row) {
        throw new Error('Failed to update episode');
      }
      return row;
    });

    logger.info({ episodeId, userId }, 'Episode updated');

    // Refresh acute-med-timing adherence if onset/start time changed.
    if (validatedData.onsetAt !== undefined || validatedData.startTime !== undefined) {
      recordAcuteAdherenceForAttack({ userId, attackId: episodeId }).catch((err) => {
        logger.warn({ userId, episodeId, err }, 'Failed to refresh acute adherence after episode patch');
      });
    }

    const shouldRecompute
      = touchesTimelineOrType
        || updateData.startTime !== undefined
        || updateData.endTime !== undefined
        || updateData.isOngoing !== undefined;

    if (shouldRecompute) {
      await this.refreshDerived({
        userId,
        episode: updated,
        previous: existing,
        context: 'episode update',
      });
    }

    return updated;
  }

  /**
   * List episodes, newest first. Unlike the previous inline implementation the
   * `from`/`to` bounds are actually applied — `list_attacks` depends on them.
   */
  async list(userId: string, input: ListEpisodesInput = {}): Promise<ListEpisodesResult> {
    const page = input.page && input.page > 0 ? input.page : 1;
    const limit = input.limit && input.limit > 0 ? input.limit : 20;
    const offset = (page - 1) * limit;

    const filters = [eq(episodeSchema.userId, userId)];
    if (input.from) {
      filters.push(gte(episodeSchema.startTime, new Date(input.from)));
    }
    if (input.to) {
      filters.push(lte(episodeSchema.startTime, new Date(input.to)));
    }
    const where = and(...filters);

    const episodes = await db
      .select()
      .from(episodeSchema)
      .where(where)
      .orderBy(desc(episodeSchema.startTime))
      .limit(limit)
      .offset(offset);

    const totalRows = await db.select({ id: episodeSchema.id }).from(episodeSchema).where(where);
    const total = totalRows.length;

    return {
      episodes: episodes.map(toEpisodeDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const episodeService = new EpisodeService();
