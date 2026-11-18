import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reading = { id: string; userId: string; episodeId: number; recordedAt: Date; intensity: number; createdAt: Date };
type EpisodeRow = {
  id: number;
  userId: string;
  startTime: Date;
  onsetAt: Date | null;
  endTime: Date | null;
  isOngoing: boolean;
  intensity: number;
};

const store = {
  consent: true,
  episodes: [] as EpisodeRow[],
  readings: [] as Reading[],
  updates: [] as Array<{ userId: string; episodeId: number; body: any }>,
};

const { getByIdMock, updateMock, hasConsentMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  hasConsentMock: vi.fn(),
}));

vi.mock('@/services/episodes/EpisodeService', async () => {
  class EpisodeError extends Error {
    code: string;
    details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return {
    EpisodeError,
    episodeService: { getById: getByIdMock, update: updateMock, hasHealthDataConsent: hasConsentMock },
  };
});

/*
 * The DB mock only knows the pain-reading table and honours the userId +
 * episodeId scoping the service is expected to apply: it reads the bound
 * values out of the drizzle `where` expression's query chunks.
 */
function boundValues(expr: any): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node.queryChunks)) {
      node.queryChunks.forEach(walk);
      return;
    }
    if (node.constructor?.name === 'Param') {
      out.push(node.value);
    }
  };
  walk(expr);
  return out;
}

function scoped(where: any): Reading[] {
  const values = boundValues(where);
  return store.readings.filter(r => values.includes(r.userId) && values.includes(r.episodeId)
    && (!values.some(v => typeof v === 'string' && v.startsWith('r-')) || values.includes(r.id)));
}

vi.mock('@/libs/DB', () => ({
  db: {
    select: (cols?: Record<string, unknown>) => ({
      from: (table: any) => {
        expect(getTableName(table)).toBe('episode_pain_reading');

        return {
          where: (where: any) => {
            const rows = () => {
              const rs = scoped(where);
              if (cols && 'peak' in cols) {
                return [{ peak: rs.length ? Math.max(...rs.map(r => r.intensity)) : null }];
              }
              return rs;
            };
            return {
              orderBy: async () => [...rows()].sort((a: any, b: any) => a.recordedAt - b.recordedAt),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            };
          },
        };
      },
    }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          const row = { id: `r-${store.readings.length + 1}`, createdAt: new Date(), ...v };
          store.readings.push(row);
          return [row];
        },
      }),
    }),
    delete: () => ({
      where: (where: any) => ({
        returning: async () => {
          const doomed = scoped(where);
          store.readings = store.readings.filter(r => !doomed.includes(r));
          return doomed.map(r => ({ id: r.id }));
        },
      }),
    }),
  },
}));

const { PainReadingService } = await import('./PainReadingService');
const service = new PainReadingService();

const NOW = new Date('2026-11-18T12:00:00Z');

beforeEach(() => {
  store.consent = true;
  store.readings = [];
  store.updates = [];
  store.episodes = [
    { id: 1, userId: 'alice', startTime: new Date('2026-11-16T22:00:00Z'), onsetAt: null, endTime: null, isOngoing: true, intensity: 3 },
    { id: 2, userId: 'bob', startTime: new Date('2026-11-17T08:00:00Z'), onsetAt: null, endTime: new Date('2026-11-17T10:00:00Z'), isOngoing: false, intensity: 2 },
  ];
  getByIdMock.mockReset().mockImplementation(async (userId: string, id: number) =>
    store.episodes.find(e => e.id === id && e.userId === userId) ?? null);
  updateMock.mockReset().mockImplementation(async (userId: string, episodeId: number, body: any) => {
    store.updates.push({ userId, episodeId, body });
    const ep = store.episodes.find(e => e.id === episodeId)!;
    Object.assign(ep, body);
    return ep;
  });
  hasConsentMock.mockReset().mockImplementation(async () => store.consent);
});

describe('PainReadingService.add', () => {
  it('records a reading across midnight and makes the first reading the attack level', async () => {
    const result = await service.add('alice', 1, { intensity: 1, recordedAt: '2026-11-17T01:30:00Z' }, NOW);

    expect(result).toEqual({
      reading: { id: 'r-1', episodeId: 1, recordedAt: '2026-11-17T01:30:00.000Z', intensity: 1 },
      peakIntensity: 1,
    });
    // The quick-start placeholder (3) does not outlive the first real reading.
    expect(store.updates).toEqual([{ userId: 'alice', episodeId: 1, body: { intensity: 1 } }]);
  });

  it('keeps the attack level at the peak of all readings', async () => {
    await service.add('alice', 1, { intensity: 4, recordedAt: '2026-11-17T01:00:00Z' }, NOW);
    store.updates = [];
    const lower = await service.add('alice', 1, { intensity: 2, recordedAt: '2026-11-18T09:00:00Z' }, NOW);

    expect(lower.peakIntensity).toBe(4);
    expect(store.updates).toEqual([]);

    const higher = await service.add('alice', 1, { intensity: 5, recordedAt: '2026-11-18T10:00:00Z' }, NOW);

    expect(higher.peakIntensity).toBe(5);
    expect(store.updates).toEqual([{ userId: 'alice', episodeId: 1, body: { intensity: 5 } }]);
  });

  it('defaults the time to now', async () => {
    const result = await service.add('alice', 1, { intensity: 2 }, NOW);

    expect(result.reading.recordedAt).toBe(NOW.toISOString());
  });

  it('rejects readings outside the attack', async () => {
    await expect(service.add('alice', 1, { intensity: 2, recordedAt: '2026-11-16T21:00:00Z' }, NOW))
      .rejects
      .toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'before_start' } });
    await expect(service.add('bob', 2, { intensity: 2, recordedAt: '2026-11-17T11:00:00Z' }, NOW))
      .rejects
      .toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'after_end' } });
    await expect(service.add('alice', 1, { intensity: 2, recordedAt: '2026-11-18T13:00:00Z' }, NOW))
      .rejects
      .toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'in_future' } });
    expect(store.readings).toEqual([]);
  });

  it('validates the level', async () => {
    await expect(service.add('alice', 1, { intensity: 0 }, NOW)).rejects.toThrow();
    await expect(service.add('alice', 1, { intensity: 6 }, NOW)).rejects.toThrow();
    await expect(service.add('alice', 1, { intensity: 2.5 }, NOW)).rejects.toThrow();
    await expect(service.add('alice', 1, { intensity: 2, recordedAt: 'yesterday' }, NOW)).rejects.toThrow();
  });

  it('requires health-data consent', async () => {
    store.consent = false;

    await expect(service.add('alice', 1, { intensity: 2 }, NOW)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('cannot add to another user\'s attack', async () => {
    await expect(service.add('alice', 2, { intensity: 2, recordedAt: '2026-11-17T09:00:00Z' }, NOW))
      .rejects
      .toMatchObject({ code: 'NOT_FOUND' });
    expect(store.readings).toEqual([]);
  });
});

describe('PainReadingService.list', () => {
  it('returns only the caller\'s readings, oldest first', async () => {
    await service.add('alice', 1, { intensity: 4, recordedAt: '2026-11-18T01:00:00Z' }, NOW);
    await service.add('alice', 1, { intensity: 2, recordedAt: '2026-11-17T01:00:00Z' }, NOW);
    await service.add('bob', 2, { intensity: 3, recordedAt: '2026-11-17T09:00:00Z' }, NOW);

    const list = await service.list('alice', 1);

    expect(list.map(r => r.recordedAt)).toEqual(['2026-11-17T01:00:00.000Z', '2026-11-18T01:00:00.000Z']);
    await expect(service.list('alice', 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PainReadingService.remove', () => {
  it('deletes a reading and re-derives the peak from what remains', async () => {
    await service.add('alice', 1, { intensity: 5, recordedAt: '2026-11-17T01:00:00Z' }, NOW);
    await service.add('alice', 1, { intensity: 2, recordedAt: '2026-11-17T05:00:00Z' }, NOW);
    store.updates = [];

    await expect(service.remove('alice', 1, 'r-1')).resolves.toBe(2);
    expect(store.updates).toEqual([{ userId: 'alice', episodeId: 1, body: { intensity: 2 } }]);
    expect(store.readings.map(r => r.id)).toEqual(['r-2']);
  });

  it('leaves the attack level alone when the last reading is removed', async () => {
    await service.add('alice', 1, { intensity: 4, recordedAt: '2026-11-17T01:00:00Z' }, NOW);
    store.updates = [];

    await expect(service.remove('alice', 1, 'r-1')).resolves.toBeNull();
    expect(store.updates).toEqual([]);
  });

  it('cannot delete another user\'s reading', async () => {
    await service.add('bob', 2, { intensity: 3, recordedAt: '2026-11-17T09:00:00Z' }, NOW);

    await expect(service.remove('alice', 2, 'r-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.remove('alice', 1, 'r-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.readings).toHaveLength(1);
  });
});
