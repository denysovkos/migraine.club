import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectReturns: any[][] = [];
const insertReturns: any[][] = [];

const valuesSpy = vi.fn();
const selectWhereSpy = vi.fn();
const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn();

vi.mock('@/libs/DB', () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((arg: unknown) => ({
            ...selectWhereSpy(arg),
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => selectReturns.shift() ?? []),
            })),
            limit: vi.fn(async () => selectReturns.shift() ?? []),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: (vals: any) => {
          valuesSpy(vals);
          return {
            returning: vi.fn(async () => insertReturns.shift() ?? []),
          };
        },
      })),
      update: vi.fn(() => ({
        set: (vals: any) => {
          updateSetSpy(vals);
          return {
            where: vi.fn(async (...args: any[]) => {
              updateWhereSpy(...args);
              return [];
            }),
          };
        },
      })),
    },
  };
});

describe('QuickAddService', () => {
  beforeEach(() => {
    selectReturns.length = 0;
    insertReturns.length = 0;
    valuesSpy.mockClear();
    selectWhereSpy.mockClear();
    updateSetSpy.mockClear();
    updateWhereSpy.mockClear();
  });

  it('auto-links medication intake to ongoing episode when present', async () => {
    // 1) ownership check => ok
    selectReturns.push([{ id: '00000000-0000-0000-0000-000000000001' }]);
    // 2) ongoing episode lookup => returns episode 123
    selectReturns.push([{ id: 123 }]);
    // insert returning intake id
    insertReturns.push([{ id: '00000000-0000-0000-0000-000000000010' }]);

    const { QuickAddService } = await import('@/services/QuickAddService');
    const svc = new QuickAddService();

    const res = await svc.createMedicationIntake({
      userId: 'user_1',
      input: {
        userMedicationId: '00000000-0000-0000-0000-000000000001',
      },
    });

    expect(res.linkedEpisodeId).toBe(123);
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 123 }));
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.anything() }));
  });

  it('does not link medication intake when there is no ongoing episode', async () => {
    // 1) ownership check => ok
    selectReturns.push([{ id: '00000000-0000-0000-0000-000000000001' }]);
    // 2) ongoing episode lookup => none
    selectReturns.push([]);
    // insert returning intake id
    insertReturns.push([{ id: '00000000-0000-0000-0000-000000000010' }]);

    const { QuickAddService } = await import('@/services/QuickAddService');
    const svc = new QuickAddService();

    const res = await svc.createMedicationIntake({
      userId: 'user_1',
      input: {
        userMedicationId: '00000000-0000-0000-0000-000000000001',
      },
    });

    expect(res.linkedEpisodeId).toBeNull();
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ episodeId: null }));
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.anything() }));
  });

  it('keeps the device time of a dose synced late and only links an attack that had started by then', async () => {
    selectReturns.push([{ id: '00000000-0000-0000-0000-000000000001' }]);
    selectReturns.push([{ id: 77 }]);
    insertReturns.push([{ id: '00000000-0000-0000-0000-000000000010' }]);

    const { QuickAddService } = await import('@/services/QuickAddService');
    const svc = new QuickAddService();

    const res = await svc.createMedicationIntake({
      userId: 'user_1',
      input: {
        userMedicationId: '00000000-0000-0000-0000-000000000001',
        takenAt: '2026-11-16T09:30:00.000Z',
      },
    });

    expect(res.linkedEpisodeId).toBe(77);
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ takenAt: new Date('2026-11-16T09:30:00.000Z') }));

    // The ongoing-attack lookup is bounded by the dose time.
    const dialect = new PgDialect();
    const ongoingWhere = dialect.sqlToQuery(selectWhereSpy.mock.calls[1]![0]);

    expect(ongoingWhere.sql).toMatch(/"start_time" <= \$\d/);
    expect(ongoingWhere.params).toContainEqual(expect.stringContaining('2026-11-16'));

    // lastUsedAt never moves backwards for a late dose.
    const lastUsed = dialect.sqlToQuery(updateSetSpy.mock.calls[0]![0].lastUsedAt);

    expect(lastUsed.sql).toContain('greatest(coalesce(');
  });
});
