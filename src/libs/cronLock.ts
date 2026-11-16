import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { cronRunLockSchema } from '@/models/Schema';

/**
 * Lease-based overlap guard for cron jobs.
 *
 * Without it, a run that is merely slow gets a second run stacked on top of it
 * every tick until the connection pool is exhausted and every request hangs.
 * A lease also survives a crashed process: it simply expires.
 */

export type CronLease = {
  jobName: string;
  runId: string;
  release: () => Promise<void>;
};

/**
 * Try to take the lease for `jobName`.
 *
 * Returns null when another run currently holds an unexpired lease — the
 * caller should report "skipped" rather than treating that as an error.
 */
export async function acquireCronLease(jobName: string, ttlMs: number): Promise<CronLease | null> {
  const runId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const claimed = await db
    .insert(cronRunLockSchema)
    .values({ jobName, runId, lockedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: cronRunLockSchema.jobName,
      set: { runId, lockedAt: now, expiresAt },
      // Only steal the row once the previous lease has actually expired.
      setWhere: lt(cronRunLockSchema.expiresAt, now),
    })
    .returning({ runId: cronRunLockSchema.runId });

  if (claimed[0]?.runId !== runId) {
    return null;
  }

  return {
    jobName,
    runId,
    release: async () => {
      try {
        // Expire our own lease. Guarded by runId so a slow run that already
        // lost its lease cannot release the lease of whoever took over.
        await db
          .update(cronRunLockSchema)
          .set({ expiresAt: sql`now()` })
          .where(and(eq(cronRunLockSchema.jobName, jobName), eq(cronRunLockSchema.runId, runId)));
      } catch (error) {
        // Best-effort: the lease expires on its own anyway.
        logger.warn({ error, jobName, runId }, 'Failed to release cron lease');
      }
    },
  };
}
