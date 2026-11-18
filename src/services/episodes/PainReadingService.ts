import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { episodePainReadingSchema } from '@/models/Schema';
import { EpisodeError, episodeService } from '@/services/episodes/EpisodeService';
import {
  attackWindow,
  checkReadingTime,
  PAIN_READING_MAX,
  PAIN_READING_MIN,
} from '@/services/episodes/painTimeline';

export const CreatePainReadingSchema = z.object({
  intensity: z.number().int().min(PAIN_READING_MIN).max(PAIN_READING_MAX),
  /** Device-captured time; defaults to now. Queued offline writes always carry it. */
  recordedAt: z.string().datetime().optional().nullable(),
});

export type PainReadingDTO = {
  id: string;
  episodeId: number;
  recordedAt: string;
  intensity: number;
};

export type AddPainReadingResult = {
  reading: PainReadingDTO;
  /** The attack's peak after this reading, which is also its stored intensity. */
  peakIntensity: number;
};

const READING_TIME_MESSAGES = {
  before_start: 'The reading is before the attack started.',
  after_end: 'The reading is after the attack ended.',
  in_future: 'The reading is in the future.',
} as const;

function toDTO(row: typeof episodePainReadingSchema.$inferSelect): PainReadingDTO {
  return {
    id: row.id,
    episodeId: row.episodeId,
    recordedAt: row.recordedAt.toISOString(),
    intensity: row.intensity,
  };
}

/**
 * Pain readings within one attack. Every query is scoped by userId as well as
 * episodeId, so one user can never read or change another user's readings.
 */
export class PainReadingService {
  private async requireEpisode(userId: string, episodeId: number) {
    const episode = await episodeService.getById(userId, episodeId);
    if (!episode) {
      throw new EpisodeError('NOT_FOUND', 'Episode not found');
    }
    return episode;
  }

  async list(userId: string, episodeId: number): Promise<PainReadingDTO[]> {
    await this.requireEpisode(userId, episodeId);
    const rows = await db
      .select()
      .from(episodePainReadingSchema)
      .where(
        and(
          eq(episodePainReadingSchema.userId, userId),
          eq(episodePainReadingSchema.episodeId, episodeId),
        ),
      )
      .orderBy(asc(episodePainReadingSchema.recordedAt));
    return rows.map(toDTO);
  }

  async add(
    userId: string,
    episodeId: number,
    body: unknown,
    now: Date = new Date(),
  ): Promise<AddPainReadingResult> {
    if (!(await episodeService.hasHealthDataConsent(userId))) {
      throw new EpisodeError(
        'CONSENT_REQUIRED',
        'You must provide explicit consent for health data processing before logging episodes.',
      );
    }

    const input = CreatePainReadingSchema.parse(body);
    const episode = await this.requireEpisode(userId, episodeId);
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : now;

    const check = checkReadingTime(recordedAt, attackWindow(episode), now);
    if (!check.ok) {
      throw new EpisodeError('VALIDATION_ERROR', READING_TIME_MESSAGES[check.reason], { reason: check.reason });
    }

    const [row] = await db
      .insert(episodePainReadingSchema)
      .values({ userId, episodeId, recordedAt, intensity: input.intensity })
      .returning();

    const peak = await this.syncPeak(userId, episodeId, episode.intensity);
    return { reading: toDTO(row!), peakIntensity: peak ?? episode.intensity };
  }

  /**
   * Once an attack has readings, its own intensity is the peak reading, so
   * reports and the diary reflect the worst point of the attack (and a
   * quick-start placeholder level never outlives the first real reading).
   * Returns the peak, or null when the attack has no readings.
   */
  private async syncPeak(userId: string, episodeId: number, current: number): Promise<number | null> {
    const [agg] = await db
      .select({ peak: max(episodePainReadingSchema.intensity) })
      .from(episodePainReadingSchema)
      .where(
        and(
          eq(episodePainReadingSchema.userId, userId),
          eq(episodePainReadingSchema.episodeId, episodeId),
        ),
      );
    const peak = agg?.peak ?? null;
    if (peak !== null && peak !== current) {
      await episodeService.update(userId, episodeId, { intensity: peak });
    }
    return peak;
  }

  /** Deletes one reading; returns the attack's peak afterwards (null when no readings remain). */
  async remove(userId: string, episodeId: number, readingId: string): Promise<number | null> {
    const episode = await this.requireEpisode(userId, episodeId);
    const deleted = await db
      .delete(episodePainReadingSchema)
      .where(
        and(
          eq(episodePainReadingSchema.id, readingId),
          eq(episodePainReadingSchema.userId, userId),
          eq(episodePainReadingSchema.episodeId, episodeId),
        ),
      )
      .returning({ id: episodePainReadingSchema.id });
    if (deleted.length === 0) {
      throw new EpisodeError('NOT_FOUND', 'Pain reading not found');
    }
    return this.syncPeak(userId, episodeId, episode.intensity);
  }
}

export const painReadingService = new PainReadingService();
