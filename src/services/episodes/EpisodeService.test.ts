import { beforeEach, describe, expect, it, vi } from 'vitest';

type EpisodeRow = {
  id: number;
  userId: string;
  isOngoing: boolean;
  attackType: 'migraine' | 'headache';
  startTime: Date;
  endTime: Date | null;
};

const store = {
  consent: true,
  episodes: [] as EpisodeRow[],
  updates: [] as Array<{ isOngoing?: boolean; endTime?: Date | null }>,
  inserted: [] as any[],
};

function tableName(table: any): string {
  return String(table?.[Symbol.for('drizzle:Name')] ?? table?._?.name ?? '');
}

vi.mock('@/libs/DB', () => {
  const db: any = {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () => {
            const name = tableName(table);
            if (name.includes('user_consent')) {
              return store.consent ? [{ consentType: 'health_data' }] : [];
            }
            if (name.includes('episode')) {
              return store.episodes.filter(e => e.isOngoing).slice(0, 1);
            }
            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          store.updates.push(values);
          const ongoing = store.episodes.find(e => e.isOngoing);
          if (ongoing) {
            ongoing.isOngoing = values.isOngoing ?? ongoing.isOngoing;
            ongoing.endTime = values.endTime ?? ongoing.endTime;
          }
          return undefined;
        },
      }),
    }),
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          const row = {
            ...values,
            id: store.episodes.length + 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.inserted.push(row);
          store.episodes.push({
            id: row.id,
            userId: row.userId,
            isOngoing: row.isOngoing,
            attackType: row.attackType,
            startTime: row.startTime,
            endTime: row.endTime ?? null,
          });
          return [row];
        },
      }),
    }),
  };
  db.transaction = async (fn: any) => fn(db);
  return { db };
});

vi.mock('@/app/api/episodes/helpers', () => ({
  computeEpisodeWeatherContext: vi.fn(async () => ({
    weatherPainIndexId: null,
    weatherContext: null,
  })),
}));

vi.mock('@/services/userTimezone', () => ({
  getUserTimezone: vi.fn(async () => 'Europe/Berlin'),
}));

vi.mock('@/services/diary/recomputeDayRows', () => ({
  recomputeDayRowsForDates: vi.fn(async () => undefined),
}));

vi.mock('@/services/insights/InsightsCacheStore', () => ({
  insightsCacheStore: { markStaleForUser: vi.fn(async () => undefined) },
}));

vi.mock('@/services/programs/recordAcuteAdherence', () => ({
  recordAcuteAdherenceForAttack: vi.fn(async () => undefined),
}));

const { EpisodeError, episodeService, resolveEndNowTime } = await import('@/services/episodes/EpisodeService');

describe('episodeService.create', () => {
  beforeEach(() => {
    store.consent = true;
    store.episodes = [];
    store.updates = [];
    store.inserted = [];
  });

  it('refuses to write without health data consent', async () => {
    store.consent = false;

    await expect(
      episodeService.create('user-1', { mode: 'quick', intensity: 3 }),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    expect(store.inserted).toHaveLength(0);
  });

  it('creates an ongoing attack when none is in progress', async () => {
    const episode = await episodeService.create('user-1', { mode: 'quick', intensity: 4 });

    expect(episode.intensity).toBe(4);
    expect(episode.isOngoing).toBe(true);
    expect(episode.attackType).toBe('migraine');
    expect(store.inserted).toHaveLength(1);
  });

  it('rejects a second ongoing attack of the same kind', async () => {
    await episodeService.create('user-1', { mode: 'quick', intensity: 3 });

    const err = await episodeService
      .create('user-1', { mode: 'quick', intensity: 2 })
      .catch(e => e);

    expect(err).toBeInstanceOf(EpisodeError);
    expect(err.code).toBe('ONGOING_EXISTS');
    expect(err.details).toMatchObject({ ongoing: { attackType: 'migraine' } });
    expect(store.inserted).toHaveLength(1);
  });

  it('ends an ongoing headache when a migraine starts', async () => {
    await episodeService.create('user-1', {
      mode: 'quick',
      intensity: 2,
      attackType: 'headache',
    });

    const migraine = await episodeService.create('user-1', {
      mode: 'quick',
      intensity: 5,
      attackType: 'migraine',
    });

    expect(migraine.attackType).toBe('migraine');
    expect(migraine.isOngoing).toBe(true);
    // The headache was closed out rather than blocking the migraine.
    expect(store.updates).toContainEqual(
      expect.objectContaining({ isOngoing: false }),
    );
    expect(store.inserted).toHaveLength(2);
  });

  it('does not check for conflicts when the new attack is not ongoing', async () => {
    await episodeService.create('user-1', { mode: 'quick', intensity: 3 });

    const past = await episodeService.create('user-1', {
      intensity: 2,
      painLocation: 'OTHER',
      painType: 'OTHER',
      isOngoing: false,
      startTime: '2026-01-01T10:00:00.000Z',
      endTime: '2026-01-01T14:00:00.000Z',
    });

    expect(past.isOngoing).toBe(false);
    expect(store.inserted).toHaveLength(2);
  });
});

describe('resolveEndNowTime', () => {
  const start = new Date('2026-11-16T08:00:00Z');
  const now = new Date('2026-11-16T12:00:00Z');

  it('uses now without a device time', () => {
    expect(resolveEndNowTime(undefined, start, now)).toBe(now);
  });

  it('keeps the device time of an end queued offline', () => {
    expect(resolveEndNowTime('2026-11-16T10:15:00Z', start, now)).toEqual(new Date('2026-11-16T10:15:00Z'));
  });

  it('never ends before the attack started or in the future', () => {
    expect(resolveEndNowTime('2026-11-16T07:00:00Z', start, now)).toBe(start);
    expect(resolveEndNowTime('2026-11-16T13:00:00Z', start, now)).toBe(now);
  });
});
