import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { Deadline } from '@/libs/asyncLimits';
import { acquireCronLease } from '@/libs/cronLock';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';

/**
 * Shared plumbing for every /api/cron/* endpoint.
 *
 * Each route was previously repeating secret validation, timing, logging and
 * error mapping by hand, and none of them bounded how long a run could take.
 * This wrapper makes all of that uniform:
 *
 *   - constant-time secret comparison
 *   - optional feature flag gate
 *   - a wall-clock budget the job must respect (jobs report leftovers and the
 *     next tick continues; every job is idempotent)
 *   - a lease so a slow run is never stacked on by the next tick
 */

/**
 * Wall-clock budget for a run. Deliberately well under the platform's
 * request timeout so the job always gets to return its own summary.
 */
export const DEFAULT_CRON_BUDGET_MS = 50_000;

/**
 * How long a lease is held. Longer than the budget so the lease outlives the
 * run itself, but short enough that a crashed process unblocks quickly.
 */
const LEASE_GRACE_MS = 30_000;

export type CronContext = {
  deadline: Deadline;
  runId: string;
};

export type CronJobConfig = {
  /** Stable identifier — used as the lease key and in logs. */
  name: string;
  /** Human-readable summary returned by the GET health check. */
  description: string;
  /** When present and false, the job reports `skipped` instead of running. */
  enabled?: boolean;
  budgetMs?: number;
  /**
   * Run the job on GET as well as POST. Needed for schedulers that only issue
   * GET requests. When false, GET is a health check unless `?run=1` is passed.
   */
  runOnGet?: boolean;
  run: (ctx: CronContext) => Promise<Record<string, unknown>>;
};

function isAuthorized(request: Request): 'ok' | 'unconfigured' | 'unauthorized' {
  const expected = Env.CRON_SECRET;

  if (!expected) {
    return 'unconfigured';
  }

  const provided = request.headers.get('x-cron-secret')
    // Vercel-style scheduler compatibility; same shared secret either way.
    ?? request.headers.get('authorization')?.replace(/^Bearer /, '')
    ?? '';

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return 'unauthorized';
  }

  return timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
}

function authFailureResponse(state: 'unconfigured' | 'unauthorized'): NextResponse {
  if (state === 'unconfigured') {
    logger.warn('CRON_SECRET not configured');
    return NextResponse.json({ error: 'Cron not configured', configured: false }, { status: 503 });
  }

  logger.warn('Invalid cron secret provided');
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Build the POST/GET handlers for a cron route.
 *
 * GET is a health check (some schedulers only support GET, so `GET` also
 * accepts `?run=1` to execute the job).
 */
export function createCronRoute(config: CronJobConfig) {
  const budgetMs = config.budgetMs ?? DEFAULT_CRON_BUDGET_MS;

  async function execute(): Promise<NextResponse> {
    if (config.enabled === false) {
      return NextResponse.json({ ok: true, job: config.name, skipped: true, reason: 'disabled' });
    }

    const lease = await acquireCronLease(config.name, budgetMs + LEASE_GRACE_MS);

    if (!lease) {
      logger.info({ job: config.name }, 'Cron run skipped: previous run still holds the lease');
      return NextResponse.json({ ok: true, job: config.name, skipped: true, reason: 'already_running' });
    }

    const deadline = new Deadline(budgetMs);

    logger.info({ job: config.name, runId: lease.runId, budgetMs }, 'Cron job started');

    try {
      const summary = await config.run({ deadline, runId: lease.runId });
      const duration = deadline.elapsedMs;

      logger.info({ job: config.name, runId: lease.runId, duration, ...summary }, 'Cron job completed');

      return NextResponse.json({ ok: true, job: config.name, runId: lease.runId, duration, ...summary });
    } catch (error) {
      const duration = deadline.elapsedMs;

      logger.error({ error, job: config.name, runId: lease.runId, duration }, 'Cron job failed');

      return NextResponse.json(
        {
          ok: false,
          job: config.name,
          error: `Failed to run ${config.name}`,
          message: error instanceof Error ? error.message : 'Unknown error',
          duration,
        },
        { status: 500 },
      );
    } finally {
      await lease.release();
    }
  }

  async function POST(request: Request): Promise<NextResponse> {
    const auth = isAuthorized(request);
    if (auth !== 'ok') {
      return authFailureResponse(auth);
    }

    return execute();
  }

  async function GET(request: Request): Promise<NextResponse> {
    const auth = isAuthorized(request);
    if (auth !== 'ok') {
      return authFailureResponse(auth);
    }

    if (config.runOnGet || new URL(request.url).searchParams.get('run') === '1') {
      return execute();
    }

    return NextResponse.json({
      ok: true,
      job: config.name,
      configured: true,
      enabled: config.enabled !== false,
      budgetMs,
      description: config.description,
      endpoints: {
        POST: 'Run the job',
        GET: config.runOnGet ? 'Run the job' : 'Health check (add ?run=1 to run the job)',
      },
    });
  }

  return { POST, GET };
}
