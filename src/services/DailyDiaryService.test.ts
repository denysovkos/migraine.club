import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectReturns: any[][] = [];
const insertReturns: any[][] = [];

vi.mock('@/libs/DB', () => {
  function makeQuery() {
    const q: any = {};
    q.limit = vi.fn(async () => selectReturns.shift() ?? []);
    q.orderBy = vi.fn(async () => selectReturns.shift() ?? []);
    // Allow `await ...where(...)` when the service doesn't chain `.limit()` or `.orderBy()`.
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
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn(async () => insertReturns.shift() ?? []),
          })),
        })),
      })),
    },
  };
});

describe('DailyDiaryService', () => {
  beforeEach(() => {
    selectReturns.length = 0;
    insertReturns.length = 0;
    vi.resetModules();
  });

  it('computes coverage for a month range (missing = no row)', async () => {
    // getUserTimezone: outcome settings empty, weather settings UTC
    selectReturns.push([{ tz1: null }]);
    selectReturns.push([{ tz2: 'UTC' }]);
    // episodes query (for attackDays indicator) -> none
    selectReturns.push([]);
    // diary rows query
    selectReturns.push([
      {
        id: '00000000-0000-0000-0000-000000000001',
        userId: 'user_1',
        localDate: new Date('2026-01-01T00:00:00Z'),
        timezone: 'UTC',
        dayType: 'headache_free',
        createdFrom: 'user',
        impact: null,
        notes: null,
        createdAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);
    // medication intakes query (for medicationDays indicator)
    selectReturns.push([]);

    const { dailyDiaryService } = await import('@/services/DailyDiaryService');
    const res = await dailyDiaryService.getDailyDiaryRange({
      userId: 'user_1',
      fromLocalDate: '2026-01-01' as any,
      toLocalDate: '2026-01-03' as any,
    });

    expect(res.coverage.totalDays).toBe(3);
    expect(res.coverage.recordedDays).toBe(1);
    expect(res.coverage.missingDays).toBe(2);
  });

  it('rejects upsert outside edit window (server-enforced)', async () => {
    // getUserTimezone: outcome settings empty, weather settings UTC
    selectReturns.push([{ tz1: null }]);
    selectReturns.push([{ tz2: 'UTC' }]);

    const { dailyDiaryService, DailyDiaryError } = await import('@/services/DailyDiaryService');

    await expect(dailyDiaryService.upsertDailyDiaryEntry({
      userId: 'user_1',
      localDate: '2025-12-30' as any,
      patch: { dayType: 'headache_free' },
      now: new Date('2026-01-06T12:00:00Z'),
    })).rejects.toBeInstanceOf(DailyDiaryError);
  });

  it('rejects setting headache_free when an attack exists on that day', async () => {
    // getUserTimezone: outcome settings empty, weather settings UTC
    selectReturns.push([{ tz1: null }]);
    selectReturns.push([{ tz2: 'UTC' }]);

    // existing diary row lookup (none)
    selectReturns.push([]);

    // attack evidence query: one migraine attack overlapping the day
    selectReturns.push([
      {
        startTime: new Date('2026-01-06T08:00:00Z'),
        endTime: new Date('2026-01-06T09:00:00Z'),
        isOngoing: false,
        attackType: 'migraine',
      },
    ]);

    const { dailyDiaryService, DailyDiaryError } = await import('@/services/DailyDiaryService');

    await expect(dailyDiaryService.upsertDailyDiaryEntry({
      userId: 'user_1',
      localDate: '2026-01-06' as any,
      patch: { dayType: 'headache_free' },
      now: new Date('2026-01-06T12:00:00Z'),
    })).rejects.toBeInstanceOf(DailyDiaryError);
  });
});
