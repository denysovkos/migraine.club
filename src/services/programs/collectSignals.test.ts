import { describe, expect, it, vi } from 'vitest';

// `eq` is mocked so the fake `where()` below can see which value a query is
// actually scoped to, instead of ignoring its argument entirely — same
// approach as src/services/intake/seedFromIntake.test.ts.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ __kind: 'eq', column, value }),
  };
});

let intakeRow: { answers: unknown; status: string } | null = null;
let intakeOwnerId = 'user-1';

/**
 * Every other collectSignals query (diary coverage, factor events, attacks,
 * acute doses) filters with `and(eq(...), gte(...), ...)`, which — because
 * only `eq` is mocked and `and`/`gte`/`lte`/`isNotNull` stay real — produces
 * a real drizzle SQL object as the `where()` condition, not our fake
 * `{ __kind: 'eq' }` marker. Only the intake query passes a bare `eq(...)`
 * straight to `.where()`. That lets this double route by condition shape
 * instead of needing to import every table for identity checks, while still
 * refusing to serve the intake row unless the predicate actually points at
 * the right user — repointing it at someone else must not leak their intake.
 */
function whereClause(condition: any) {
  if (condition?.__kind === 'eq') {
    return {
      limit: async () => (condition.value === intakeOwnerId && intakeRow ? [intakeRow] : []),
    };
  }
  return Promise.resolve([]);
}

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: whereClause,
        // Only the factor-events query joins; it doesn't touch intake gating.
        innerJoin: () => ({ where: whereClause }),
      }),
    }),
  },
}));

const { collectSignals } = await import('./collectSignals');

const habitsAnswers = {
  frequency: null,
  triggers: null,
  medications: null,
  habits: { sleepTrouble: 'often', typicalBed: '23:00', typicalWake: '07:00', medTiming: 'gt120' },
};

describe('collectSignals — intake gate', () => {
  it('populates intake from a completed intake row', async () => {
    intakeRow = { answers: habitsAnswers, status: 'completed' };
    intakeOwnerId = 'user-1';

    const signals = await collectSignals({ userId: 'user-1', today: '2026-09-10', timezone: 'UTC' });

    expect(signals.intake).toEqual({ sleepTrouble: 'often', medTiming: 'gt120' });
  });

  it('does not feed recommendations from an in-progress intake', async () => {
    intakeRow = { answers: habitsAnswers, status: 'in_progress' };
    intakeOwnerId = 'user-1';

    const signals = await collectSignals({ userId: 'user-1', today: '2026-09-10', timezone: 'UTC' });

    expect(signals.intake).toBeNull();
  });

  it('does not feed recommendations from a skipped intake', async () => {
    intakeRow = { answers: habitsAnswers, status: 'skipped' };
    intakeOwnerId = 'user-1';

    const signals = await collectSignals({ userId: 'user-1', today: '2026-09-10', timezone: 'UTC' });

    expect(signals.intake).toBeNull();
  });

  it('returns null intake when the user has no intake row at all', async () => {
    intakeRow = null;
    intakeOwnerId = 'user-1';

    const signals = await collectSignals({ userId: 'user-1', today: '2026-09-10', timezone: 'UTC' });

    expect(signals.intake).toBeNull();
  });

  it('does not surface another user\'s completed intake when repointed at the wrong user', async () => {
    // Same fixture as the "populates intake" test, but the tx's owner is not
    // the caller's userId — proves where() actually applies its predicate
    // instead of ignoring it, matching the pattern in seedFromIntake.test.ts.
    intakeRow = { answers: habitsAnswers, status: 'completed' };
    intakeOwnerId = 'someone-else';

    const signals = await collectSignals({ userId: 'user-1', today: '2026-09-10', timezone: 'UTC' });

    expect(signals.intake).toBeNull();
  });
});
