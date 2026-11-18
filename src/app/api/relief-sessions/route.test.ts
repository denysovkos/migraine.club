import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { authMock, listMock, addMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  listMock: vi.fn(),
  addMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/relief/ReliefSessionService', () => ({
  reliefSessionService: { list: listMock, add: addMock },
}));
vi.mock('@/services/episodes/EpisodeService', () => {
  class EpisodeError extends Error {
    code: string;
    details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return { EpisodeError };
});

const { GET, POST } = await import('./route');
const { EpisodeError } = await import('@/services/episodes/EpisodeService');

const BODY = { exercise: 'breathing', startedAt: '2026-11-18T11:55:00.000Z', durationSeconds: 200, completed: true };

function post(body: unknown) {
  return new Request('http://localhost/api/relief-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const get = (query = '') => GET(new Request(`http://localhost/api/relief-sessions${query}`));

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'alice' });
  listMock.mockReset();
  addMock.mockReset();
});

describe('GET /api/relief-sessions', () => {
  it('requires sign-in', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await get()).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('returns the caller\'s sessions, optionally for one attack', async () => {
    listMock.mockResolvedValue([{ id: 's1', exercise: 'pmr' }]);
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [{ id: 's1', exercise: 'pmr' }] });
    expect(listMock).toHaveBeenCalledWith('alice', { episodeId: undefined });

    await get('?episodeId=7');

    expect(listMock).toHaveBeenLastCalledWith('alice', { episodeId: 7 });
  });

  it('rejects a malformed episode id', async () => {
    for (const id of ['abc', '1.5', '-1', '0', '']) {
      expect((await get(`?episodeId=${id}`)).status).toBe(400);
    }

    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/relief-sessions', () => {
  it('requires sign-in', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await POST(post(BODY))).status).toBe(401);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('records a session for the caller', async () => {
    addMock.mockResolvedValue({ id: 's1', ...BODY, episodeId: null, helped: null });
    const res = await POST(post(BODY));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ session: { id: 's1', ...BODY, episodeId: null, helped: null } });
    expect(addMock).toHaveBeenCalledWith('alice', BODY);
  });

  it('rejects invalid JSON', async () => {
    expect((await POST(post('{nope'))).status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('maps validation, consent and ownership errors', async () => {
    addMock.mockRejectedValueOnce(z.object({ exercise: z.enum(['breathing']) }).safeParse({ exercise: 'yoga' }).error);

    expect((await POST(post({ ...BODY, exercise: 'yoga' }))).status).toBe(400);

    addMock.mockRejectedValueOnce(new EpisodeError('VALIDATION_ERROR', 'future', { reason: 'in_future' }));
    const future = await POST(post(BODY));

    expect(future.status).toBe(400);
    expect(await future.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'in_future' } });

    addMock.mockRejectedValueOnce(new EpisodeError('CONSENT_REQUIRED', 'consent'));

    expect((await POST(post(BODY))).status).toBe(403);

    addMock.mockRejectedValueOnce(new EpisodeError('NOT_FOUND', 'Episode not found'));

    expect((await POST(post({ ...BODY, episodeId: 99 }))).status).toBe(404);

    addMock.mockRejectedValueOnce(new Error('db down'));

    expect((await POST(post(BODY))).status).toBe(500);
  });
});
