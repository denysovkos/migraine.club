import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const getUserTimezoneMock = vi.fn();
vi.mock('@/services/userTimezone', () => ({
  getUserTimezone: getUserTimezoneMock,
}));

const recomputeDayRowsForDatesMock = vi.fn();
vi.mock('@/services/diary/recomputeDayRows', () => ({
  recomputeDayRowsForDates: recomputeDayRowsForDatesMock,
}));

const getAttackTreatmentModelMock = vi.fn();
vi.mock('@/services/acuteMedications/attackTreatmentModel', () => ({
  getAttackTreatmentModel: getAttackTreatmentModelMock,
}));

vi.mock('@/libs/Logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const selectResults: unknown[] = [];
let existingEpisode: Record<string, any>;
let capturedUpdateData: Record<string, any> | null = null;

function createSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => (selectResults.shift() as unknown[]) ?? []),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve((selectResults.shift() as unknown[]) ?? []).then(resolve, reject),
  };

  return chain;
}

const dbMock = {
  select: vi.fn(() => createSelectChain()),
  transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, any>) => {
        capturedUpdateData = data;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{
              ...existingEpisode,
              ...data,
            }]),
          })),
        };
      }),
    })),
  })),
};

vi.mock('@/libs/DB', () => ({ db: dbMock }));

describe('PATCH /api/episodes/[id]', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T12:00:00.000Z'));

    authMock.mockReset();
    getUserTimezoneMock.mockReset();
    recomputeDayRowsForDatesMock.mockReset();
    getAttackTreatmentModelMock.mockReset();
    dbMock.select.mockClear();
    dbMock.transaction.mockClear();
    selectResults.length = 0;
    capturedUpdateData = null;

    existingEpisode = {
      id: 42,
      userId: 'user-1',
      attackType: 'migraine',
      startTime: new Date('2026-04-01T09:00:00.000Z'),
      endTime: null,
      isOngoing: true,
      intensity: 7,
      painLocation: 'left',
      painLocationOther: null,
      painType: 'throbbing',
      painTypeOther: null,
      symptoms: [],
      symptomsOther: null,
      triggers: [],
      protectors: [],
      triggersOther: null,
      notes: null,
      weatherPainIndexId: null,
      weatherContext: null,
      createdAt: new Date('2026-04-01T09:00:00.000Z'),
      updatedAt: new Date('2026-04-01T09:00:00.000Z'),
    };
  });

  it('allows ending an ongoing episode now even when it started outside the edit window', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getUserTimezoneMock.mockResolvedValue('UTC');
    getAttackTreatmentModelMock.mockResolvedValue(null);

    selectResults.push([existingEpisode], []);

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/episodes/42', {
        method: 'PATCH',
        body: JSON.stringify({ endNow: true }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isOngoing).toBe(false);
    expect(new Date(body.endTime).toISOString()).toBe('2026-04-13T12:00:00.000Z');
    expect(capturedUpdateData).toMatchObject({
      isOngoing: false,
    });
    expect(capturedUpdateData?.endTime).toBeInstanceOf(Date);
    expect((capturedUpdateData?.endTime as Date).toISOString()).toBe('2026-04-13T12:00:00.000Z');
  });

  it('allows editing a finished episode when it ended inside the edit window even if it started earlier', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getUserTimezoneMock.mockResolvedValue('UTC');
    getAttackTreatmentModelMock.mockResolvedValue(null);

    existingEpisode = {
      ...existingEpisode,
      startTime: new Date('2026-04-04T07:24:00.000Z'),
      endTime: new Date('2026-04-13T08:21:00.000Z'),
      isOngoing: false,
    };

    selectResults.push([existingEpisode], []);

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/episodes/42', {
        method: 'PATCH',
        body: JSON.stringify({
          startTime: '2026-04-04T07:24:00.000Z',
          endTime: '2026-04-12T08:21:00.000Z',
          isOngoing: false,
          intensity: 3,
          painLocation: 'WHOLE_HEAD',
          painType: 'THROBBING',
          symptoms: [],
          triggers: [],
          protectors: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isOngoing).toBe(false);
    expect(new Date(body.endTime).toISOString()).toBe('2026-04-12T08:21:00.000Z');
    expect(capturedUpdateData).toMatchObject({
      isOngoing: false,
      intensity: 3,
      painLocation: 'WHOLE_HEAD',
      painType: 'THROBBING',
      symptoms: [],
      triggers: [],
      protectors: [],
    });
    expect((capturedUpdateData?.endTime as Date).toISOString()).toBe('2026-04-12T08:21:00.000Z');
  });

  it('ends at the device time sent with endNow (an end queued offline)', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getUserTimezoneMock.mockResolvedValue('UTC');
    getAttackTreatmentModelMock.mockResolvedValue(null);
    selectResults.push([existingEpisode], []);

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/episodes/42', {
        method: 'PATCH',
        body: JSON.stringify({ endNow: true, endedAt: '2026-04-13T10:45:00.000Z' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect(res.status).toBe(200);
    expect((capturedUpdateData?.endTime as Date).toISOString()).toBe('2026-04-13T10:45:00.000Z');
  });

  it('never ends before the attack started, whatever the device clock says', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getUserTimezoneMock.mockResolvedValue('UTC');
    getAttackTreatmentModelMock.mockResolvedValue(null);
    existingEpisode = { ...existingEpisode, startTime: new Date('2026-04-13T09:00:00.000Z') };
    selectResults.push([existingEpisode], []);

    const mod = await import('./route');
    await mod.PATCH(
      new Request('http://localhost/api/episodes/42', {
        method: 'PATCH',
        body: JSON.stringify({ endNow: true, endedAt: '2026-04-12T23:00:00.000Z' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect((capturedUpdateData?.endTime as Date).toISOString()).toBe('2026-04-13T09:00:00.000Z');
  });

  it('refuses an edit captured by another account on the device', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/episodes/42', {
        method: 'PATCH',
        body: JSON.stringify({ endNow: true }),
        headers: { 'Content-Type': 'application/json', 'X-Offline-User': 'user-2' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect(res.status).toBe(409);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    authMock.mockResolvedValue({ userId: null });

    const mod = await import('./route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/episodes/42', { method: 'PATCH', body: '{}' }),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect(res.status).toBe(401);
  });
});
