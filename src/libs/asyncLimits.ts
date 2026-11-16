/**
 * Small async primitives shared by the cron jobs.
 *
 * The cron endpoints run behind a load balancer with a hard request timeout,
 * so every job must bound both how long it runs and how many things it does
 * at once. These helpers are the two knobs used everywhere.
 */

/**
 * A wall-clock budget for a single cron run.
 *
 * Jobs check `expired` between units of work and stop early, reporting how
 * much was left over. Because every cron job is idempotent, the next tick
 * simply picks the remainder up.
 */
export class Deadline {
  readonly startedAt: number;
  readonly endsAt: number;

  constructor(budgetMs: number) {
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + budgetMs;
  }

  get remainingMs(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  get expired(): boolean {
    return Date.now() >= this.endsAt;
  }

  /**
   * Budget for a single sub-operation: whatever is left, capped at `maxMs`.
   * Returns 0 when the deadline has already passed.
   */
  sliceMs(maxMs: number): number {
    return Math.min(maxMs, this.remainingMs);
  }
}

/**
 * Reject with a timeout error if `promise` has not settled within `ms`.
 *
 * Note this does not cancel the underlying work — it stops the *caller* from
 * waiting on it. Use it as a backstop around calls that have no native
 * cancellation, never as a replacement for a real request timeout.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type MapWithConcurrencyResult<R> = {
  results: R[];
  /** Number of input items never started because the deadline expired. */
  remaining: number;
};

/**
 * Map over `items` with at most `concurrency` in flight, stopping early once
 * `deadline` expires.
 *
 * `fn` must not throw — handle per-item failures inside it and encode them in
 * the result — so that one bad item cannot abort the whole run.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  deadline?: Deadline,
): Promise<MapWithConcurrencyResult<R>> {
  const limit = Math.max(1, Math.floor(concurrency));
  const slots = Array.from<R | undefined>({ length: items.length });
  let next = 0;
  let stoppedAt = items.length;

  async function worker(): Promise<void> {
    while (true) {
      if (deadline?.expired) {
        stoppedAt = Math.min(stoppedAt, next);
        return;
      }

      const index = next++;
      if (index >= items.length) {
        return;
      }

      slots[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  const done = Math.min(stoppedAt, items.length);

  return {
    results: slots.slice(0, done).filter((r): r is R => r !== undefined),
    remaining: Math.max(0, items.length - done),
  };
}
