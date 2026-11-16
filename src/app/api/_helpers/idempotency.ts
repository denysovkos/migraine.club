import { and, eq, isNull, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { idempotentRequestSchema } from '@/models/Schema';

/**
 * Idempotent replay for client writes.
 *
 * Entries logged while offline are queued on the device and sent later,
 * possibly more than once: the first attempt can reach the server while its
 * response is lost to a dropped connection. The client tags every queued
 * write with a stable `Idempotency-Key`, and this helper makes sure that key
 * produces at most one side effect per user.
 *
 * Requests without the header behave exactly as before.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * The Clerk user id that was signed in when the entry was queued. If a
 * different account is signed in by the time the queue is flushed, the write
 * is refused instead of landing in the wrong person's diary.
 */
export const OFFLINE_USER_HEADER = 'x-offline-user';

const KEY_RE = /^[\w-]{8,100}$/;

/** A reservation older than this with no stored response is treated as abandoned. */
const STALE_RESERVATION_MS = 2 * 60 * 1000;

export type StoredResponse = { status: number; body: unknown };

export type ReserveResult
  = | { kind: 'reserved' }
    | { kind: 'completed'; response: StoredResponse }
    | { kind: 'in_progress' };

export type IdempotencyStore = {
  reserve: (args: { userId: string; key: string; route: string }) => Promise<ReserveResult>;
  complete: (args: { userId: string; key: string; response: StoredResponse }) => Promise<void>;
  release: (args: { userId: string; key: string }) => Promise<void>;
};

export const dbIdempotencyStore: IdempotencyStore = {
  async reserve({ userId, key, route }) {
    const inserted = await db
      .insert(idempotentRequestSchema)
      .values({ userId, idempotencyKey: key, route })
      .onConflictDoNothing()
      .returning({ id: idempotentRequestSchema.id });
    if (inserted.length > 0) {
      return { kind: 'reserved' };
    }

    const [existing] = await db
      .select({
        responseStatus: idempotentRequestSchema.responseStatus,
        responseBody: idempotentRequestSchema.responseBody,
      })
      .from(idempotentRequestSchema)
      .where(and(eq(idempotentRequestSchema.userId, userId), eq(idempotentRequestSchema.idempotencyKey, key)))
      .limit(1);

    if (existing && existing.responseStatus !== null) {
      return { kind: 'completed', response: { status: existing.responseStatus, body: existing.responseBody } };
    }

    // Take over a reservation left behind by a request that crashed mid-way.
    const takenOver = await db
      .update(idempotentRequestSchema)
      .set({ createdAt: new Date(), route })
      .where(and(
        eq(idempotentRequestSchema.userId, userId),
        eq(idempotentRequestSchema.idempotencyKey, key),
        isNull(idempotentRequestSchema.responseStatus),
        lt(idempotentRequestSchema.createdAt, new Date(Date.now() - STALE_RESERVATION_MS)),
      ))
      .returning({ id: idempotentRequestSchema.id });

    return takenOver.length > 0 ? { kind: 'reserved' } : { kind: 'in_progress' };
  },

  async complete({ userId, key, response }) {
    await db
      .update(idempotentRequestSchema)
      .set({ responseStatus: response.status, responseBody: response.body ?? null })
      .where(and(eq(idempotentRequestSchema.userId, userId), eq(idempotentRequestSchema.idempotencyKey, key)));
  },

  async release({ userId, key }) {
    await db
      .delete(idempotentRequestSchema)
      .where(and(
        eq(idempotentRequestSchema.userId, userId),
        eq(idempotentRequestSchema.idempotencyKey, key),
        isNull(idempotentRequestSchema.responseStatus),
      ));
  },
};

/**
 * Wrap a write handler so that a request carrying `Idempotency-Key` runs at
 * most once per (user, key). Only 2xx responses are remembered; an error
 * releases the key so the client can retry after fixing the cause.
 */
export async function withIdempotency(
  request: Request,
  userId: string,
  route: string,
  handler: () => Promise<Response>,
  store: IdempotencyStore = dbIdempotencyStore,
): Promise<Response> {
  const offlineUser = request.headers.get(OFFLINE_USER_HEADER);
  if (offlineUser && offlineUser !== userId) {
    return NextResponse.json(
      { error: 'This entry was saved by a different account on this device.', code: 'OFFLINE_USER_MISMATCH' },
      { status: 409 },
    );
  }

  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (!key) {
    return handler();
  }
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: 'Invalid Idempotency-Key', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
  }

  const reservation = await store.reserve({ userId, key, route });
  if (reservation.kind === 'completed') {
    return NextResponse.json(reservation.response.body, {
      status: reservation.response.status,
      headers: { 'Idempotent-Replayed': 'true' },
    });
  }
  if (reservation.kind === 'in_progress') {
    return NextResponse.json(
      { error: 'The same entry is already being saved.', code: 'IDEMPOTENCY_IN_PROGRESS' },
      { status: 409, headers: { 'Retry-After': '5' } },
    );
  }

  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    await store.release({ userId, key }).catch(() => {});
    throw error;
  }

  try {
    if (response.status >= 200 && response.status < 300) {
      const body = await response.clone().json().catch(() => null);
      await store.complete({ userId, key, response: { status: response.status, body } });
    } else {
      await store.release({ userId, key });
    }
  } catch (error) {
    // The write itself succeeded; failing to record it only weakens dedupe.
    logger.warn({ userId, route, error }, 'Failed to record idempotent response');
  }

  return response;
}

/**
 * Accepts a client-captured timestamp for an entry that may be synced late.
 * Returns `fallback` when absent. Rejects times in the future (beyond a small
 * clock-skew allowance) or older than `maxAgeDays`.
 */
export function resolveCapturedAt(
  iso: string | null | undefined,
  fallback: Date,
  opts: { maxAgeDays?: number; skewMs?: number } = {},
): Date | { error: string } {
  if (!iso) {
    return fallback;
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return { error: 'Invalid timestamp' };
  }
  const skewMs = opts.skewMs ?? 5 * 60 * 1000;
  const maxAgeMs = (opts.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
  const now = fallback.getTime();
  if (at.getTime() > now + skewMs) {
    return { error: 'Timestamp is in the future' };
  }
  if (at.getTime() < now - maxAgeMs) {
    return { error: 'Timestamp is too old to sync' };
  }
  // Clamp small positive skew so nothing is stored in the future.
  return at.getTime() > now ? fallback : at;
}
