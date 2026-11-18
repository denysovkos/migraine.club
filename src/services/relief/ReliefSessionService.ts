import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reliefSessionSchema } from '@/models/Schema';
import { EpisodeError, episodeService } from '@/services/episodes/EpisodeService';
import { RELIEF_EXERCISES, RELIEF_HELPED_CHOICES } from '@/types/Relief';

/** Longest session we accept; the built-in exercises run 3–4 minutes. */
export const RELIEF_MAX_DURATION_SECONDS = 60 * 60;
/** Device clocks drift; a start this far ahead of the server is still accepted. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const LIST_LIMIT = 100;

export const CreateReliefSessionSchema = z.object({
  exercise: z.enum(RELIEF_EXERCISES),
  /** Device-captured start, so a session queued offline keeps its time. */
  startedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0).max(RELIEF_MAX_DURATION_SECONDS),
  /** False when the user stopped before the end. */
  completed: z.boolean(),
  /** Answer to "Did it help?"; null or absent when skipped. */
  helped: z.enum(RELIEF_HELPED_CHOICES).nullable().optional(),
  /** The attack the session was used in, if any. */
  episodeId: z.number().int().positive().nullable().optional(),
});

export type ReliefSessionDTO = {
  id: string;
  episodeId: number | null;
  exercise: string;
  startedAt: string;
  durationSeconds: number;
  completed: boolean;
  helped: string | null;
};

function toDTO(row: typeof reliefSessionSchema.$inferSelect): ReliefSessionDTO {
  return {
    id: row.id,
    episodeId: row.episodeId,
    exercise: row.exercise,
    startedAt: row.startedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    completed: row.completed,
    helped: row.helped,
  };
}

/**
 * Relief sessions are health data: writing needs consent, and every query is
 * scoped by userId so one user never reads another user's sessions or links a
 * session to someone else's attack.
 */
export class ReliefSessionService {
  async add(userId: string, body: unknown, now: Date = new Date()): Promise<ReliefSessionDTO> {
    if (!(await episodeService.hasHealthDataConsent(userId))) {
      throw new EpisodeError(
        'CONSENT_REQUIRED',
        'You must provide explicit consent for health data processing before logging episodes.',
      );
    }

    const input = CreateReliefSessionSchema.parse(body);
    const startedAt = new Date(input.startedAt);
    if (startedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw new EpisodeError('VALIDATION_ERROR', 'The session starts in the future.', { reason: 'in_future' });
    }

    const episodeId = input.episodeId ?? null;
    if (episodeId !== null && !(await episodeService.getById(userId, episodeId))) {
      throw new EpisodeError('NOT_FOUND', 'Episode not found');
    }

    const [row] = await db
      .insert(reliefSessionSchema)
      .values({
        userId,
        episodeId,
        exercise: input.exercise,
        startedAt,
        durationSeconds: input.durationSeconds,
        completed: input.completed,
        helped: input.helped ?? null,
      })
      .returning();
    return toDTO(row!);
  }

  /** The user's sessions, newest first; only those of one attack when `episodeId` is given. */
  async list(userId: string, opts: { episodeId?: number } = {}): Promise<ReliefSessionDTO[]> {
    const where = opts.episodeId === undefined
      ? eq(reliefSessionSchema.userId, userId)
      : and(eq(reliefSessionSchema.userId, userId), eq(reliefSessionSchema.episodeId, opts.episodeId));
    const rows = await db
      .select()
      .from(reliefSessionSchema)
      .where(where)
      .orderBy(desc(reliefSessionSchema.startedAt))
      .limit(LIST_LIMIT);
    return rows.map(toDTO);
  }
}

export const reliefSessionService = new ReliefSessionService();
