import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type Row = {
  id: string;
  userId: string;
  episodeId: number | null;
  exercise: string;
  startedAt: Date;
  durationSeconds: number;
  completed: boolean;
  helped: string | null;
  createdAt: Date;
};

const store = { consent: true, rows: [] as Row[], episodes: [] as Array<{ id: number; userId: string }> };

const { getByIdMock, hasConsentMock } = vi.hoisted(() => ({ getByIdMock: vi.fn(), hasConsentMock: vi.fn() }));

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
  return { EpisodeError, episodeService: { getById: getByIdMock, hasHealthDataConsent: hasConsentMock } };
});

/** Values bound into a drizzle `where` expression, so the mock honours the service's scoping. */
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

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        expect(getTableName(table)).toBe('relief_session');

        return {
          where: (where: any) => {
            const values = boundValues(where);
            const numbers = values.filter(v => typeof v === 'number');
            const rows = store.rows.filter(r => values.includes(r.userId)
              && (numbers.length === 0 || (r.episodeId !== null && numbers.includes(r.episodeId))));
            return {
              orderBy: () => ({
                limit: async (n: number) => [...rows].sort((a, b) => +b.startedAt - +a.startedAt).slice(0, n),
              }),
            };
          },
        };
      },
    }),
    insert: (table: any) => {
      expect(getTableName(table)).toBe('relief_session');

      return {
        values: (v: any) => ({
          returning: async () => {
            const row = { id: `s-${store.rows.length + 1}`, createdAt: new Date(), ...v };
            store.rows.push(row);
            return [row];
          },
        }),
      };
    },
  },
}));

const { ReliefSessionService } = await import('./ReliefSessionService');
const service = new ReliefSessionService();

const NOW = new Date('2026-11-18T12:00:00Z');
const VALID = {
  exercise: 'breathing',
  startedAt: '2026-11-18T11:55:00.000Z',
  durationSeconds: 200,
  completed: true,
  helped: 'a_little',
};

beforeEach(() => {
  store.consent = true;
  store.rows = [];
  store.episodes = [{ id: 1, userId: 'alice' }, { id: 2, userId: 'bob' }];
  getByIdMock.mockReset().mockImplementation(async (userId: string, id: number) =>
    store.episodes.find(e => e.id === id && e.userId === userId) ?? null);
  hasConsentMock.mockReset().mockImplementation(async () => store.consent);
});

describe('ReliefSessionService.add', () => {
  it('records a session linked to the user\'s own attack', async () => {
    const dto = await service.add('alice', { ...VALID, episodeId: 1 }, NOW);

    expect(dto).toEqual({
      id: 's-1',
      episodeId: 1,
      exercise: 'breathing',
      startedAt: '2026-11-18T11:55:00.000Z',
      durationSeconds: 200,
      completed: true,
      helped: 'a_little',
    });
    expect(store.rows[0]!.userId).toBe('alice');
  });

  it('records a session outside an attack and a skipped "did it help"', async () => {
    const dto = await service.add('alice', { ...VALID, helped: undefined, completed: false, durationSeconds: 40 }, NOW);

    expect(dto).toMatchObject({ episodeId: null, helped: null, completed: false, durationSeconds: 40 });
  });

  it('refuses to link a session to another user\'s attack', async () => {
    await expect(service.add('alice', { ...VALID, episodeId: 2 }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.rows).toHaveLength(0);
  });

  it('requires health data consent', async () => {
    store.consent = false;

    await expect(service.add('alice', VALID, NOW)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(store.rows).toHaveLength(0);
  });

  it.each([
    ['unknown exercise', { exercise: 'yoga' }],
    ['unknown helped answer', { helped: 'maybe' }],
    ['negative duration', { durationSeconds: -1 }],
    ['duration over an hour', { durationSeconds: 3601 }],
    ['fractional duration', { durationSeconds: 1.5 }],
    ['missing start', { startedAt: undefined }],
    ['non-ISO start', { startedAt: 'yesterday' }],
    ['missing completed flag', { completed: undefined }],
  ])('rejects %s', async (_name, patch) => {
    await expect(service.add('alice', { ...VALID, ...patch }, NOW)).rejects.toBeInstanceOf(z.ZodError);
  });

  it('rejects a start in the future beyond clock skew, accepts small drift', async () => {
    await expect(service.add('alice', { ...VALID, startedAt: '2026-11-18T12:10:00.000Z' }, NOW))
      .rejects
      .toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(service.add('alice', { ...VALID, startedAt: '2026-11-18T12:02:00.000Z' }, NOW)).resolves.toBeTruthy();
  });
});

describe('ReliefSessionService.list', () => {
  it('lists only the user\'s own sessions, newest first, filtered by attack', async () => {
    await service.add('alice', { ...VALID, startedAt: '2026-11-18T10:00:00.000Z', episodeId: 1 }, NOW);
    await service.add('alice', { ...VALID, startedAt: '2026-11-18T11:00:00.000Z', exercise: 'pmr' }, NOW);
    await service.add('bob', { ...VALID, episodeId: 2 }, NOW);

    expect((await service.list('alice')).map(s => s.exercise)).toEqual(['pmr', 'breathing']);
    expect((await service.list('alice', { episodeId: 1 })).map(s => s.episodeId)).toEqual([1]);
    expect(await service.list('alice', { episodeId: 2 })).toEqual([]);
    expect((await service.list('bob')).map(s => s.episodeId)).toEqual([2]);
  });
});
