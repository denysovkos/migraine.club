import type { IdempotencyStore, StoredResponse } from './idempotency';
import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { resolveCapturedAt, withIdempotency } from './idempotency';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function memoryStore() {
  const rows = new Map<string, StoredResponse | null>();
  const store: IdempotencyStore = {
    async reserve({ userId, key }) {
      const k = `${userId}:${key}`;
      if (!rows.has(k)) {
        rows.set(k, null);
        return { kind: 'reserved' };
      }
      const existing = rows.get(k);
      return existing ? { kind: 'completed', response: existing } : { kind: 'in_progress' };
    },
    async complete({ userId, key, response }) {
      rows.set(`${userId}:${key}`, response);
    },
    async release({ userId, key }) {
      if (rows.get(`${userId}:${key}`) === null) {
        rows.delete(`${userId}:${key}`);
      }
    },
  };
  return { store, rows };
}

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/x', { method: 'POST', headers });
}

describe('withIdempotency', () => {
  it('runs the handler normally without an Idempotency-Key', async () => {
    const { store, rows } = memoryStore();
    const handler = vi.fn(async () => NextResponse.json({ id: 1 }, { status: 201 }));

    const res = await withIdempotency(req(), 'user_a', 'x', handler, store);

    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(0);
  });

  it('creates once and returns the stored response on replay', async () => {
    const { store } = memoryStore();
    let n = 0;
    const handler = vi.fn(async () => NextResponse.json({ episodeId: ++n }, { status: 201 }));
    const headers = { 'Idempotency-Key': 'key-12345678' };

    const first = await withIdempotency(req(headers), 'user_a', 'x', handler, store);
    const replay = await withIdempotency(req(headers), 'user_a', 'x', handler, store);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual({ episodeId: 1 });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual({ episodeId: 1 });
  });

  it('scopes keys per user', async () => {
    const { store } = memoryStore();
    const handler = vi.fn(async () => NextResponse.json({}, { status: 201 }));
    const headers = { 'Idempotency-Key': 'key-12345678' };

    await withIdempotency(req(headers), 'user_a', 'x', handler, store);
    await withIdempotency(req(headers), 'user_b', 'x', handler, store);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('answers 409 while the same key is still being processed', async () => {
    const { store, rows } = memoryStore();
    rows.set('user_a:key-12345678', null);

    const res = await withIdempotency(req({ 'Idempotency-Key': 'key-12345678' }), 'user_a', 'x', vi.fn(), store);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('releases the key after an error response so the client can retry', async () => {
    const { store, rows } = memoryStore();
    const handler = vi.fn()
      .mockResolvedValueOnce(NextResponse.json({ error: 'nope' }, { status: 500 }))
      .mockResolvedValueOnce(NextResponse.json({ ok: true }, { status: 201 }));
    const headers = { 'Idempotency-Key': 'key-12345678' };

    expect((await withIdempotency(req(headers), 'user_a', 'x', handler, store)).status).toBe(500);
    expect(rows.size).toBe(0);
    expect((await withIdempotency(req(headers), 'user_a', 'x', handler, store)).status).toBe(201);
  });

  it('releases the key when the handler throws', async () => {
    const { store, rows } = memoryStore();
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(withIdempotency(req({ 'Idempotency-Key': 'key-12345678' }), 'user_a', 'x', handler, store))
      .rejects
      .toThrow('boom');
    expect(rows.size).toBe(0);
  });

  it('refuses entries captured by a different account on the device', async () => {
    const { store } = memoryStore();
    const handler = vi.fn();

    const res = await withIdempotency(req({ 'X-Offline-User': 'user_b' }), 'user_a', 'x', handler, store);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('OFFLINE_USER_MISMATCH');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects malformed keys', async () => {
    const { store } = memoryStore();
    const res = await withIdempotency(req({ 'Idempotency-Key': 'bad key!' }), 'user_a', 'x', vi.fn(), store);

    expect(res.status).toBe(400);
  });
});

describe('resolveCapturedAt', () => {
  const now = new Date('2026-11-16T12:00:00Z');

  it('falls back to now when absent', () => {
    expect(resolveCapturedAt(undefined, now)).toBe(now);
  });

  it('keeps a plausible past time', () => {
    expect(resolveCapturedAt('2026-11-16T08:30:00Z', now)).toEqual(new Date('2026-11-16T08:30:00Z'));
  });

  it('clamps small clock skew into the present', () => {
    expect(resolveCapturedAt('2026-11-16T12:02:00Z', now)).toBe(now);
  });

  it('rejects times well in the future or beyond the window', () => {
    expect(resolveCapturedAt('2026-11-16T13:00:00Z', now)).toEqual({ error: 'Timestamp is in the future' });
    expect(resolveCapturedAt('2026-11-01T12:00:00Z', now, { maxAgeDays: 7 })).toEqual({ error: 'Timestamp is too old to sync' });
  });
});
