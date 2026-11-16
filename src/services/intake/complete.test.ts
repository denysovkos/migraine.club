import { beforeEach, describe, expect, it, vi } from 'vitest';

// `rows` is the durable intake_response table (one row, single-user tests).
// `medicationRows` is a generic stand-in for anything seedFromIntake writes
// via its tx (user_medications/preventive_plan/factor) — this file mocks
// seedFromIntake entirely, so it's only ever populated by a test explicitly
// asking the mock to perform a write.
const rows: any[] = [];
const medicationRows: any[] = [];
let concurrentFlipArmed = false;
// Records the mode `IntakeService.complete` actually passes to `.for(...)` on
// the row lock. `FOR SHARE` lets two concurrent completers both acquire the
// lock and both read `in_progress` — reinstating the TOCTOU this suite exists
// to close — so this must be `'update'`, not merely "some string was passed".
let lastLockMode: string | undefined;

const seedMock = vi.fn(async (..._args: any[]) => ({
  userMedicationIds: ['m1'],
  preventivePlanIds: [],
  factorIds: [],
  at: '2026-09-10T00:00:00.000Z',
}));

vi.mock('@/services/intake/seedFromIntake', () => ({ seedFromIntake: (...args: any[]) => seedMock(...args) }));
vi.mock('@/services/userTimezone', () => ({ getUserTimezone: async () => 'Europe/Kyiv' }));

vi.mock('@/libs/DB', () => {
  // Reads always see the live, already-committed state — including a status
  // flip simulating a concurrent complete() that already committed while we
  // were between the pre-transaction fast-path check and the row lock below.
  const reader = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows.slice(0, 1),
          for: async (mode: string) => {
            lastLockMode = mode;
            if (concurrentFlipArmed && rows[0] && rows[0].status !== 'completed') {
              rows[0] = { ...rows[0], status: 'completed' };
            }
            return rows.slice(0, 1);
          },
        }),
      }),
    }),
  };

  // Outside a transaction, a write commits immediately (real Postgres
  // autocommit semantics). `sink` lets `db.insert` and a transaction's
  // (initially staged) `tx.insert` share the same commit logic.
  function commit(v: any, set: any | undefined) {
    if (set) {
      if (rows.length === 0) {
        rows.push({ ...v });
      } else {
        Object.assign(rows[0], set);
      }
    } else {
      medicationRows.push(v);
    }
  }

  function makeInsert(sink: (v: any, set: any | undefined) => void) {
    return () => ({
      values: (v: any) => ({
        returning: async () => {
          sink(v, undefined);
          return [{ id: `new-${medicationRows.length}` }];
        },
        onConflictDoUpdate: async ({ set }: any) => {
          sink(v, set);
        },
      }),
    });
  }

  const db = {
    ...reader,
    insert: makeInsert(commit),
    transaction: async (fn: any) => {
      // Stage writes made through `tx` and only fold them into the durable
      // state if `fn` resolves. A throw discards the pending writes and
      // rethrows — real rollback semantics, not drizzle's, but enough to
      // prove the atomicity guarantee here.
      const pending: Array<{ v: any; set: any | undefined }> = [];
      const tx = { ...reader, insert: makeInsert((v, set) => pending.push({ v, set })) };

      const result = await fn(tx);

      for (const { v, set } of pending) {
        commit(v, set);
      }
      return result;
    },
  };

  return { db };
});

const { intakeService } = await import('./IntakeService');

describe('intakeService.complete', () => {
  beforeEach(() => {
    rows.length = 0;
    medicationRows.length = 0;
    concurrentFlipArmed = false;
    lastLockMode = undefined;
    seedMock.mockClear();
    seedMock.mockImplementation(async (..._args: any[]) => ({
      userMedicationIds: ['m1'],
      preventivePlanIds: [],
      factorIds: [],
      at: '2026-09-10T00:00:00.000Z',
    }));
  });

  it('seeds once and marks the intake completed', async () => {
    rows.push({
      userId: 'user-1',
      version: 1,
      status: 'in_progress',
      currentStep: 4,
      answers: {},
      seeded: {},
      completedAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    await intakeService.complete('user-1');

    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('completed');
    // The row lock must be FOR UPDATE (exclusive), not FOR SHARE — a shared
    // lock lets two concurrent completers both proceed, both read
    // `in_progress`, and both seed.
    expect(lastLockMode).toBe('update');
  });

  it('does nothing on a second complete', async () => {
    rows.push({
      userId: 'user-1',
      version: 1,
      status: 'completed',
      currentStep: 4,
      answers: {},
      seeded: { userMedicationIds: ['m1'] },
      completedAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    await intakeService.complete('user-1');

    expect(seedMock).not.toHaveBeenCalled();
  });

  it('does not double-seed when a concurrent complete() commits between the fast-path check and the row lock', async () => {
    // Reproduces the double-tap-on-"Finish" race: the pre-transaction status
    // check sees `in_progress`, but by the time this transaction acquires the
    // row lock, a concurrent request has already completed and committed.
    rows.push({
      userId: 'user-1',
      version: 1,
      status: 'in_progress',
      currentStep: 4,
      answers: {},
      seeded: {},
      completedAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    concurrentFlipArmed = true;

    await intakeService.complete('user-1');

    expect(seedMock).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('completed');
  });

  it('rolls back and leaves the intake row untouched when seeding rejects mid-transaction', async () => {
    rows.push({
      userId: 'user-1',
      version: 1,
      status: 'in_progress',
      currentStep: 4,
      answers: {},
      seeded: {},
      completedAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    // Simulate seedFromIntake having already written one row via `tx` (e.g. a
    // medication) before a later step in the same seed fails.
    seedMock.mockImplementationOnce(async (tx: any) => {
      await tx.insert({}).values({ id: 'partial-medication' }).returning();
      throw new Error('boom');
    });

    await expect(intakeService.complete('user-1')).rejects.toThrow('boom');

    expect(rows[0].status).toBe('in_progress');
    expect(rows[0].seeded).toEqual({});
    expect(medicationRows).toHaveLength(0);
  });
});
