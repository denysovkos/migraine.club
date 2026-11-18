'use client';

import type { ReliefExercise, ReliefHelped } from '@/types/Relief';
import { sendOrQueue } from '@/libs/offline/outbox';

export type ReliefSessionInput = {
  exercise: ReliefExercise;
  startedAt: Date;
  durationSeconds: number;
  completed: boolean;
  helped: ReliefHelped | null;
  episodeId: number | null;
};

/**
 * Record one relief session. Goes through the offline outbox like every other
 * attack mode write, so a session done without a connection is still saved
 * and keeps its own start time.
 */
export async function recordReliefSession(input: ReliefSessionInput): Promise<{ queued: boolean }> {
  const result = await sendOrQueue({
    url: '/api/relief-sessions',
    method: 'POST',
    body: {
      exercise: input.exercise,
      startedAt: input.startedAt.toISOString(),
      durationSeconds: Math.max(0, Math.round(input.durationSeconds)),
      completed: input.completed,
      helped: input.helped,
      episodeId: input.episodeId,
    },
    kind: 'relief',
  });
  if (result.queued) {
    return { queued: true };
  }
  if (!result.response.ok) {
    const data = await result.response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save relaxation');
  }
  return { queued: false };
}
