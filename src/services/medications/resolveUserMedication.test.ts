import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
  rows: [] as Array<{ id: string; userId: string; isAcute: boolean }>,
  ensureCalls: [] as Array<{ userId: string; customName: string }>,
};

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => store.rows.slice(0, 1).map(r => ({ id: r.id, isAcute: r.isAcute })),
        }),
      }),
    }),
  },
}));

vi.mock('@/services/QuickAddService', () => ({
  quickAddService: {
    ensureUserMedicationForCustom: vi.fn(async (args: { userId: string; customName: string }) => {
      store.ensureCalls.push(args);
      const id = 'med-created';
      // New custom medications inherit the column default: acute.
      store.rows = [{ id, userId: args.userId, isAcute: true }];
      return id;
    }),
  },
}));

const { MedicationResolutionError, resolveUserMedication } = await import(
  '@/services/medications/resolveUserMedication',
);

describe('resolveUserMedication', () => {
  beforeEach(() => {
    store.rows = [];
    store.ensureCalls = [];
  });

  it('creates an unknown medication from free text and treats it as acute', async () => {
    const result = await resolveUserMedication('user-1', { medicationName: 'sumatriptan' });

    expect(store.ensureCalls).toEqual([{ userId: 'user-1', customName: 'sumatriptan' }]);
    expect(result).toEqual({ id: 'med-created', isAcute: true });
  });

  it('uses an explicit id without creating anything', async () => {
    store.rows = [{ id: 'med-existing', userId: 'user-1', isAcute: false }];

    const result = await resolveUserMedication('user-1', { userMedicationId: 'med-existing' });

    expect(store.ensureCalls).toHaveLength(0);
    expect(result).toEqual({ id: 'med-existing', isAcute: false });
  });

  it('requires either a name or an id', async () => {
    await expect(resolveUserMedication('user-1', {})).rejects.toBeInstanceOf(
      MedicationResolutionError,
    );
  });

  it('rejects an id that does not belong to the user', async () => {
    store.rows = [];

    await expect(
      resolveUserMedication('user-1', { userMedicationId: 'someone-elses-med' }),
    ).rejects.toMatchObject({ code: 'MEDICATION_NOT_FOUND' });
  });
});
