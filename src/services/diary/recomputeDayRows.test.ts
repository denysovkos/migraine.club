import { describe, expect, it, vi } from 'vitest';

const selectReturns: any[] = [];
const insertCalls: any[] = [];
const deleteCalls: any[] = [];

vi.mock('@/libs/DB', () => {
  function makeQuery() {
    const q: any = {};
    q.then = (resolve: any, reject: any) =>
      Promise.resolve(selectReturns.shift() ?? []).then(resolve, reject);
    return q;
  }

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => makeQuery()),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((v: any) => {
          insertCalls.push(v);
          return {
            onConflictDoUpdate: vi.fn(async () => ({})),
          };
        }),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async (w: any) => {
          deleteCalls.push(w);
          return {};
        }),
      })),
    },
  };
});

describe('recomputeDayRowsForDates', () => {
  it('upserts migraine_day for all local dates touched by a migraine attack (midnight-spanning)', async () => {
    selectReturns.length = 0;
    insertCalls.length = 0;
    deleteCalls.length = 0;

    // 1) episodes overlapping range
    selectReturns.push([
      {
        id: 1,
        startTime: new Date('2024-01-01T23:00:00Z'),
        endTime: new Date('2024-01-02T01:00:00Z'),
        isOngoing: false,
        attackType: 'migraine',
      },
    ]);
    // 2) existing diary rows for those dates
    selectReturns.push([]);

    const { recomputeDayRowsForDates } = await import('@/services/diary/recomputeDayRows');
    await recomputeDayRowsForDates({
      userId: 'user_1',
      timezone: 'UTC',
      localDates: ['2024-01-01', '2024-01-02'],
      now: new Date('2024-01-02T01:00:00Z'),
    });

    expect(insertCalls.length).toBe(2);
    expect(insertCalls.map(v => v.dayType).sort()).toEqual(['migraine_day', 'migraine_day']);
  });

  it('deletes createdFrom=attack rows when no attacks remain (returns to missing)', async () => {
    selectReturns.length = 0;
    insertCalls.length = 0;
    deleteCalls.length = 0;

    // 1) episodes overlapping range -> none
    selectReturns.push([]);
    // 2) existing diary rows for the date -> createdFrom=attack
    selectReturns.push([
      {
        id: '00000000-0000-0000-0000-000000000123',
        userId: 'user_1',
        localDate: new Date('2024-01-01T00:00:00Z'),
        timezone: 'UTC',
        dayType: 'headache_day',
        createdFrom: 'attack',
        impact: null,
        notes: null,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
    ]);

    const { recomputeDayRowsForDates } = await import('@/services/diary/recomputeDayRows');
    await recomputeDayRowsForDates({
      userId: 'user_1',
      timezone: 'UTC',
      localDates: ['2024-01-01'],
    });

    expect(insertCalls.length).toBe(0);
    expect(deleteCalls.length).toBe(1);
  });
});
