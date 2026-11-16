import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/preventives/PreventivePlansService', () => ({
  preventivePlansService: {
    createPlan: vi.fn(async () => ({ id: 'plan-1' })),
  },
}));

// `eq`/`inArray` are mocked so the fake `where()` below can see which value a
// query is actually scoped to, instead of ignoring its argument entirely.
// Everything else in drizzle-orm is left real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ __kind: 'eq', column, value }),
    inArray: (column: unknown, values: unknown) => ({ __kind: 'inArray', column, values }),
  };
});

const { seedFromIntake } = await import('./seedFromIntake');
const { preventivePlansService } = await import('@/services/preventives/PreventivePlansService');
const { medicationsCatalogSchema, userMedicationsSchema, factorSchema } = await import('@/models/Schema');

/**
 * Transaction double with real (not rubber-stamp) semantics:
 * - `select().from(userMedicationsSchema).where(eq(userId, ...))` only returns
 *   `existingMeds` when the predicate actually points at `ownerId` — repointing
 *   the query at a different user must fail the dedupe tests, not pass them.
 * - `select().from(medicationsCatalogSchema).where(inArray(id, ...))` returns
 *   whatever `catalogTags` says for the requested ids.
 * - Factor inserts key a real conflict store by `(userId, key)`, seeded from
 *   `existingFactors` so a conflict from a PREVIOUS call (not just an earlier
 *   iteration within the same call) is exercised too; a bare `.returning()`
 *   with no `.onConflictDoNothing()` throws, so deleting that clause in the
 *   source fails the suite instead of silently working. `.onConflictDoNothing`
 *   only dedupes when its `target` is actually the `(userId, key)` arbiter —
 *   a different (or missing) target must not suppress the insert, so pointing
 *   it at `factorSchema.id` (which can never conflict) fails the suite too.
 */
function makeTx(options: {
  existingMeds?: Array<{ id: string; catalogMedicationId: string | null; customName: string | null }>;
  catalogTags?: Record<string, string[]>;
  ownerId?: string;
  existingFactors?: Array<{ userId: string; key: string }>;
} = {}) {
  const { existingMeds = [], catalogTags = {}, ownerId = 'user-1', existingFactors = [] } = options;
  const inserted: any[] = [];
  const factorConflictStore = new Set<string>(existingFactors.map(f => `${f.userId}:${f.key}`));

  const tx = {
    select: () => ({
      from: (table: any) => ({
        where: async (condition: any) => {
          if (table === userMedicationsSchema) {
            return condition?.__kind === 'eq' && condition.value === ownerId ? existingMeds : [];
          }
          if (table === medicationsCatalogSchema) {
            const ids: string[] = condition?.__kind === 'inArray' ? condition.values : [];
            return ids.filter(id => id in catalogTags).map(id => ({ id, tags: catalogTags[id] }));
          }
          return [];
        },
      }),
    }),
    insert: (table: any) => ({
      values: (v: any) => ({
        returning: async () => {
          if (table === factorSchema) {
            // Real code always chains .onConflictDoNothing() before
            // .returning() for factor inserts. Reaching a bare .returning()
            // here means that clause was removed — fail loudly instead of
            // silently behaving like an unconditional insert.
            throw new Error('factor insert reached .returning() without .onConflictDoNothing() — idempotency guard missing');
          }
          inserted.push(v);
          return [{ id: `new-${inserted.length}` }];
        },
        onConflictDoNothing: (opts: { target?: unknown[] } = {}) => ({
          returning: async () => {
            const target = opts.target ?? [];
            const isRealArbiter = target.length === 2 && target[0] === factorSchema.userId && target[1] === factorSchema.key;
            const key = `${v.userId}:${v.key}`;

            if (isRealArbiter) {
              if (factorConflictStore.has(key)) {
                return [];
              }
              factorConflictStore.add(key);
            }

            inserted.push(v);
            return [{ id: `new-${inserted.length}` }];
          },
        }),
      }),
    }),
  } as any;

  return { tx, inserted };
}

const answers = {
  frequency: { band: '4_7' as const },
  triggers: { keys: ['stress'], custom: ['loud office'] },
  medications: {
    acute: [{ catalogMedicationId: '11111111-1111-1111-1111-111111111111', defaultDose: '50', defaultUnit: 'mg' }],
    preventive: [{ name: 'Propranolol', kind: 'oral' as const, scheduleType: 'daily' as const, startDate: null }],
  },
  habits: { sleepTrouble: 'often' as const, typicalBed: '23:30', typicalWake: '07:00', medTiming: 'gt120' as const },
};

describe('seedFromIntake', () => {
  it('creates a user medication for an acute entry the user does not already have', async () => {
    const { tx, inserted } = makeTx();

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(1);
    expect(inserted.some(v => v.catalogMedicationId === '11111111-1111-1111-1111-111111111111')).toBe(true);
  });

  it('pins the first three acute medications so they surface in Quick Kit', async () => {
    const { tx, inserted } = makeTx();
    const many = {
      ...answers,
      medications: {
        acute: ['a', 'b', 'c', 'd'].map(n => ({ customName: n })),
        preventive: [],
      },
    };

    await seedFromIntake(tx, { userId: 'user-1', answers: many as any, todayYmd: '2026-09-10' });

    const meds = inserted.filter(v => 'isPinned' in v);

    expect(meds.filter(v => v.isPinned)).toHaveLength(3);
  });

  it('skips an acute medication the user already owns, by catalog id', async () => {
    const { tx } = makeTx({
      existingMeds: [
        { id: 'existing-1', catalogMedicationId: '11111111-1111-1111-1111-111111111111', customName: null },
      ],
    });

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(0);
  });

  it('skips an acute medication the user already owns, matching custom name case-insensitively', async () => {
    const { tx } = makeTx({
      existingMeds: [{ id: 'existing-1', catalogMedicationId: null, customName: 'Ibuprofen' }],
    });
    const custom = { ...answers, medications: { acute: [{ customName: 'ibuprofen' }], preventive: [] } };

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers: custom as any, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(0);
  });

  it('skips an acute medication the user already owns even when whitespace differs', async () => {
    const { tx, inserted } = makeTx({
      existingMeds: [{ id: 'existing-1', catalogMedicationId: null, customName: 'Ibu profen' }],
    });
    const custom = { ...answers, triggers: null, medications: { acute: [{ customName: 'Ibu  profen' }], preventive: [] } };

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers: custom as any, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('stores customName with internal whitespace collapsed, matching the canonical writer', async () => {
    const { tx, inserted } = makeTx();
    const custom = { ...answers, medications: { acute: [{ customName: '  Ibu   profen  ' }], preventive: [] } };

    await seedFromIntake(tx, { userId: 'user-1', answers: custom as any, todayYmd: '2026-09-10' });

    expect(inserted.find(v => 'customName' in v)?.customName).toBe('Ibu profen');
  });

  it('does not surface another user\'s medications as owned when repointed at the wrong user', async () => {
    // Same fixture as the "already owns, by catalog id" test, but the tx's
    // owner is not the caller's userId — proves where() actually applies its
    // predicate instead of ignoring it.
    const { tx } = makeTx({
      existingMeds: [
        { id: 'existing-1', catalogMedicationId: '11111111-1111-1111-1111-111111111111', customName: null },
      ],
      ownerId: 'someone-else',
    });

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(1);
  });

  it('skips an acute medication entry with neither a catalog id nor a custom name', async () => {
    const { tx, inserted } = makeTx();
    const blank = { ...answers, triggers: null, medications: { acute: [{}], preventive: [] } };

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers: blank as any, todayYmd: '2026-09-10' });

    expect(seeded.userMedicationIds).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('derives medicationClass from an unambiguous catalog tag when the entry does not specify one', async () => {
    const { tx, inserted } = makeTx({
      catalogTags: { '11111111-1111-1111-1111-111111111111': ['type:brand', 'triptan'] },
    });

    await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(inserted.find(v => 'medicationClass' in v)?.medicationClass).toBe('triptan');
  });

  it('falls back to the default medicationClass when the catalog has no matching tag', async () => {
    const { tx, inserted } = makeTx({
      catalogTags: { '11111111-1111-1111-1111-111111111111': ['type:ingredient', 'atc:N02CC0'] },
    });

    await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(inserted.find(v => 'medicationClass' in v)?.medicationClass).toBe('non_opioid_simple_analgesic');
  });

  it('keeps an explicit medicationClass over whatever the catalog tags say', async () => {
    const { tx, inserted } = makeTx({
      catalogTags: { '11111111-1111-1111-1111-111111111111': ['triptan'] },
    });
    const explicit = {
      ...answers,
      medications: {
        acute: [{ catalogMedicationId: '11111111-1111-1111-1111-111111111111', medicationClass: 'opioid' as const }],
        preventive: [],
      },
    };

    await seedFromIntake(tx, { userId: 'user-1', answers: explicit as any, todayYmd: '2026-09-10' });

    expect(inserted.find(v => 'medicationClass' in v)?.medicationClass).toBe('opioid');
  });

  it('creates preventive plans with reminders off and today as the fallback start date', async () => {
    const { tx } = makeTx();

    await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    expect(preventivePlansService.createPlan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Propranolol', startDate: '2026-09-10', remindersEnabled: false }),
      tx,
    );
  });

  it('creates factor rows for custom triggers only, never for built-in keys', async () => {
    const { tx, inserted } = makeTx();

    await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    const factors = inserted.filter(v => v.displayName !== undefined);

    expect(factors).toHaveLength(1);
    expect(factors[0].displayName).toBe('loud office');
    expect(factors[0].type).toBe('trigger');
  });

  it('does not insert the same custom trigger twice in one call', async () => {
    const { tx, inserted } = makeTx();
    const dup = { ...answers, triggers: { keys: [], custom: ['loud office', 'Loud Office'] } };

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers: dup as any, todayYmd: '2026-09-10' });

    const factors = inserted.filter(v => v.displayName !== undefined);

    expect(factors).toHaveLength(1);
    expect(seeded.factorIds).toHaveLength(1);
  });

  it('does not duplicate a custom trigger the user already has from a previous intake call', async () => {
    // Unlike the within-call dedupe test above, this factor conflict is
    // pre-existing — proving `onConflictDoNothing` (not just the in-memory
    // loop) is what prevents the duplicate.
    const { tx, inserted } = makeTx({
      existingFactors: [{ userId: 'user-1', key: 'intake.trigger:loud_office' }],
    });

    const seeded = await seedFromIntake(tx, { userId: 'user-1', answers, todayYmd: '2026-09-10' });

    const factors = inserted.filter(v => v.displayName !== undefined);

    expect(factors).toHaveLength(0);
    expect(seeded.factorIds).toHaveLength(0);
  });

  it('writes nothing when every block was skipped', async () => {
    const { tx, inserted } = makeTx();

    const seeded = await seedFromIntake(tx, {
      userId: 'user-1',
      answers: { frequency: null, triggers: null, medications: null, habits: null },
      todayYmd: '2026-09-10',
    });

    expect(inserted).toHaveLength(0);
    expect(seeded.userMedicationIds).toHaveLength(0);
    expect(seeded.preventivePlanIds).toHaveLength(0);
    expect(seeded.factorIds).toHaveLength(0);
  });
});
