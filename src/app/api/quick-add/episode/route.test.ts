import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const consentMock = vi.fn();
vi.mock('@/app/api/_helpers/healthDataConsent', () => ({ hasHealthDataConsent: consentMock }));

vi.mock('@/app/api/episodes/helpers', () => ({
  computeEpisodeWeatherContext: vi.fn(async () => ({ weatherPainIndexId: null, weatherContext: null })),
}));
vi.mock('@/services/userTimezone', () => ({ getUserTimezone: vi.fn(async () => 'Europe/Berlin') }));
const recomputeMock = vi.fn();
vi.mock('@/services/diary/recomputeDayRows', () => ({ recomputeDayRowsForDates: recomputeMock }));
vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let ongoingRows: unknown[] = [];
const insertedValues: Record<string, any>[] = [];

const dbMock = {
  select: vi.fn(() => ({
    from: () => ({
      where: async () => ongoingRows,
    }),
  })),
  insert: vi.fn(() => ({
    values: (vals: Record<string, any>) => {
      insertedValues.push(vals);
      return { returning: async () => [{ id: 99 }] };
    },
  })),
  transaction: vi.fn(),
};
vi.mock('@/libs/DB', () => ({ db: dbMock }));

const NOW = new Date('2026-11-16T12:00:00.000Z');

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/quick-add/episode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/quick-add/episode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    authMock.mockResolvedValue({ userId: 'user_a' });
    consentMock.mockResolvedValue(true);
    ongoingRows = [];
    insertedValues.length = 0;
    dbMock.insert.mockClear();
    dbMock.select.mockClear();
    recomputeMock.mockReset();
  });

  it('starts the attack at the device-captured time, not at sync time', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ attackType: 'migraine', startedAt: '2026-11-16T09:15:00.000Z' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episodeId: 99 });
    expect(insertedValues[0]).toMatchObject({
      isOngoing: true,
      attackType: 'migraine',
      startTime: new Date('2026-11-16T09:15:00.000Z'),
      onsetAt: new Date('2026-11-16T09:15:00.000Z'),
    });
  });

  it('defaults to now when no capture time is sent (older clients)', async () => {
    const { POST } = await import('./route');
    await POST(post({ attackType: 'headache' }));

    expect(insertedValues[0]!.startTime).toEqual(NOW);
  });

  it('clamps a small clock skew to now', async () => {
    const { POST } = await import('./route');
    await POST(post({ startedAt: '2026-11-16T12:03:00.000Z' }));

    expect(insertedValues[0]!.startTime).toEqual(NOW);
  });

  it.each([
    ['in the future', '2026-11-16T13:00:00.000Z'],
    ['older than the 7-day sync window', '2026-11-08T11:00:00.000Z'],
  ])('rejects a capture time %s without writing', async (_label, startedAt) => {
    const { POST } = await import('./route');
    const res = await POST(post({ startedAt }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_STARTED_AT');
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('rejects a malformed capture time', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ startedAt: 'yesterday' }));

    expect(res.status).toBe(400);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('answers 409 ONGOING_EXISTS when an attack is already running (queued entry is then parked for review)', async () => {
    ongoingRows = [{ id: 7, attackType: 'migraine', isOngoing: true, startTime: NOW, endTime: null }];
    const { POST } = await import('./route');
    const res = await POST(post({ attackType: 'migraine', startedAt: '2026-11-16T11:00:00.000Z' }));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ONGOING_EXISTS');
  });

  it('keeps the historical path for a past diary day', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ attackType: 'migraine', localDate: '2026-11-14' }));

    expect(res.status).toBe(201);
    expect(insertedValues[0]).toMatchObject({ isOngoing: false });
    expect(insertedValues[0]!.startTime.toISOString()).toBe('2026-11-14T11:00:00.000Z');
  });

  it('refuses an entry captured by another account before touching the database', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ attackType: 'migraine' }, { 'X-Offline-User': 'user_b' }));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('OFFLINE_USER_MISMATCH');
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('accepts an entry from the same account', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ attackType: 'migraine' }, { 'X-Offline-User': 'user_a' }));

    expect(res.status).toBe(201);
  });

  it('requires a session', async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import('./route');
    const res = await POST(post({}));

    expect(res.status).toBe(401);
  });

  it('requires health-data consent', async () => {
    consentMock.mockResolvedValue(false);
    const { POST } = await import('./route');
    const res = await POST(post({}));

    expect(res.status).toBe(403);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
