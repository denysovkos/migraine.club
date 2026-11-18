import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { authMock, listMock, addMock, removeMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  listMock: vi.fn(),
  addMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/episodes/PainReadingService', () => ({
  painReadingService: { list: listMock, add: addMock, remove: removeMock },
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
const { DELETE } = await import('./[readingId]/route');
const { EpisodeError } = await import('@/services/episodes/EpisodeService');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const READING_ID = '6f1c1f0e-8a0d-4b7e-9c2a-1d2e3f4a5b6c';

function post(body: unknown) {
  return new Request('http://localhost/api/episodes/1/pain-readings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'alice' });
  listMock.mockReset();
  addMock.mockReset();
  removeMock.mockReset();
});

describe('GET /api/episodes/:id/pain-readings', () => {
  it('requires sign-in', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await GET(new Request('http://localhost'), ctx('1'))).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed id', async () => {
    for (const id of ['abc', '1.5', '-1', '0']) {
      expect((await GET(new Request('http://localhost'), ctx(id))).status).toBe(400);
    }
  });

  it('returns the caller\'s readings', async () => {
    listMock.mockResolvedValue([{ id: 'r', episodeId: 1, recordedAt: '2026-11-17T01:00:00.000Z', intensity: 3 }]);
    const res = await GET(new Request('http://localhost'), ctx('1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ readings: [{ id: 'r', episodeId: 1, recordedAt: '2026-11-17T01:00:00.000Z', intensity: 3 }] });
    expect(listMock).toHaveBeenCalledWith('alice', 1);
  });

  it('is 404 for an attack that is not the caller\'s', async () => {
    listMock.mockRejectedValue(new EpisodeError('NOT_FOUND', 'Episode not found'));

    expect((await GET(new Request('http://localhost'), ctx('2'))).status).toBe(404);
  });
});

describe('POST /api/episodes/:id/pain-readings', () => {
  it('requires sign-in', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await POST(post({ intensity: 3 }), ctx('1'))).status).toBe(401);
  });

  it('creates a reading', async () => {
    addMock.mockResolvedValue({ reading: { id: 'r' }, peakIntensity: 4 });
    const res = await POST(post({ intensity: 4, recordedAt: '2026-11-17T01:00:00.000Z' }), ctx('1'));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ reading: { id: 'r' }, peakIntensity: 4 });
    expect(addMock).toHaveBeenCalledWith('alice', 1, { intensity: 4, recordedAt: '2026-11-17T01:00:00.000Z' });
  });

  it('rejects invalid JSON', async () => {
    expect((await POST(post('{nope'), ctx('1'))).status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('maps validation, consent and ownership errors', async () => {
    addMock.mockRejectedValueOnce(new EpisodeError('VALIDATION_ERROR', 'The reading is after the attack ended.', { reason: 'after_end' }));
    const outside = await POST(post({ intensity: 2 }), ctx('1'));

    expect(outside.status).toBe(400);
    expect(await outside.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'after_end' } });

    addMock.mockRejectedValueOnce(z.object({ intensity: z.number().max(5) }).safeParse({ intensity: 9 }).error);

    expect((await POST(post({ intensity: 9 }), ctx('1'))).status).toBe(400);

    addMock.mockRejectedValueOnce(new EpisodeError('CONSENT_REQUIRED', 'consent'));
    const consent = await POST(post({ intensity: 2 }), ctx('1'));

    expect(consent.status).toBe(403);
    expect(await consent.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });

    addMock.mockRejectedValueOnce(new EpisodeError('NOT_FOUND', 'Episode not found'));

    expect((await POST(post({ intensity: 2 }), ctx('2'))).status).toBe(404);

    addMock.mockRejectedValueOnce(new Error('db down'));

    expect((await POST(post({ intensity: 2 }), ctx('1'))).status).toBe(500);
  });
});

describe('DELETE /api/episodes/:id/pain-readings/:readingId', () => {
  const del = (id: string, readingId: string) =>
    DELETE(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id, readingId }) });

  it('requires sign-in', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await del('1', READING_ID)).status).toBe(401);
  });

  it('rejects malformed ids', async () => {
    expect((await del('x', READING_ID)).status).toBe(400);
    expect((await del('1', 'not-a-uuid')).status).toBe(400);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('deletes and returns the peak afterwards', async () => {
    removeMock.mockResolvedValue(3);
    const res = await del('1', READING_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, peakIntensity: 3 });
    expect(removeMock).toHaveBeenCalledWith('alice', 1, READING_ID);
  });

  it('is 404 for a reading that is not the caller\'s', async () => {
    removeMock.mockRejectedValue(new EpisodeError('NOT_FOUND', 'Pain reading not found'));

    expect((await del('1', READING_ID)).status).toBe(404);
  });
});
