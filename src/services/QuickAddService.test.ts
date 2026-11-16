import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectReturns: any[][] = [];
const insertReturns: any[][] = [];

const valuesSpy = vi.fn();
const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn();

vi.mock('@/libs/DB', () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
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
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.any(Date) }));
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
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.any(Date) }));
  });
});
