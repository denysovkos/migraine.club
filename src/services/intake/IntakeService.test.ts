import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rows are keyed by userId, mirroring the real table's primary key, so tests
// can assert that reads/writes are actually scoped to the calling user.
const rowsByUser = new Map<string, any>();
const rows = () => Array.from(rowsByUser.values());

// `eq` is mocked so the fake `where()` below can see which userId a query is
// actually scoped to, instead of ignoring its argument. `sql` (used for the
// GREATEST(...) expression) is left real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_column: unknown, value: unknown) => ({ __mockEq: true, value }),
  };
});

vi.mock('@/libs/DB', () => {
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: any) => ({
          limit: async () => {
            const row = rowsByUser.get(condition.value);
            // Snapshot, not a live reference: a real SELECT returns the row as
            // it was at read time, so a later write to the map must not be
            // visible through a row object read earlier — otherwise a stale
            // read could never be constructed in tests.
            return row ? [{ ...row, answers: { ...row.answers } }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: async ({ set }: any) => {
          const existing = rowsByUser.get(v.userId);
          if (!existing) {
            rowsByUser.set(v.userId, { ...v });
            return;
          }
          const resolved: any = {};
          for (const key of Object.keys(set)) {
            const value = set[key];
            // `currentStep` may arrive as a real drizzle SQL object (the
            // GREATEST(...) expression) instead of a plain number. Emulate
            // Postgres's GREATEST(current column, excluded.current_step)
            // semantics instead of blindly assigning it.
            if (key === 'currentStep' && typeof value !== 'number') {
              resolved.currentStep = Math.max(existing.currentStep, v.currentStep);
            } else {
              resolved[key] = value;
            }
          }
          Object.assign(existing, resolved);
        },
      }),
    }),
  };
  return { db };
});

const { INTAKE_VERSION } = await import('@/models/intake');
const { intakeService } = await import('./IntakeService');

describe('intakeService', () => {
  beforeEach(() => {
    rowsByUser.clear();
  });

  it('returns an in-progress DTO with all blocks null when no row exists', async () => {
    const dto = await intakeService.get('user-1');

    expect(dto.status).toBe('in_progress');
    expect(dto.currentStep).toBe(0);
    expect(dto.answers.frequency).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('advances currentStep past the patched block', async () => {
    await intakeService.patchBlock('user-1', { block: 'frequency', value: { band: '4_7' } });

    expect(rowsByUser.get('user-1').currentStep).toBe(1);
    expect(rowsByUser.get('user-1').answers.frequency).toEqual({ band: '4_7' });
  });

  it('never moves currentStep backwards', async () => {
    await intakeService.patchBlock('user-1', { block: 'habits', value: null });
    await intakeService.patchBlock('user-1', { block: 'frequency', value: { band: 'lt1' } });

    expect(rowsByUser.get('user-1').currentStep).toBe(4);
  });

  it('preserves other blocks when patching one', async () => {
    await intakeService.patchBlock('user-1', { block: 'frequency', value: { band: '1_3' } });
    await intakeService.patchBlock('user-1', { block: 'triggers', value: { keys: ['stress'], custom: [] } });

    expect(rowsByUser.get('user-1').answers.frequency).toEqual({ band: '1_3' });
    expect(rowsByUser.get('user-1').answers.triggers).toEqual({ keys: ['stress'], custom: [] });
  });

  it('skip sets status to skipped', async () => {
    await intakeService.skip('user-1');

    expect(rowsByUser.get('user-1').status).toBe('skipped');
  });

  it('skip cannot downgrade an already-completed intake', async () => {
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    rowsByUser.set('user-completed', {
      userId: 'user-completed',
      version: INTAKE_VERSION,
      status: 'completed',
      currentStep: 4,
      answers: { frequency: { band: '4_7' } },
      seeded: { program: 'sleep-regularity' },
      completedAt,
    });

    const dto = await intakeService.skip('user-completed');

    expect(dto.status).toBe('completed');

    const stored = rowsByUser.get('user-completed');

    expect(stored.status).toBe('completed');
    expect(stored.completedAt).toBe(completedAt);
    expect(stored.seeded).toEqual({ program: 'sleep-regularity' });
  });

  it('does not leak one user\'s intake row into another user\'s read', async () => {
    await intakeService.patchBlock('user-1', { block: 'frequency', value: { band: '4_7' } });

    const dto = await intakeService.get('user-2');

    expect(dto.status).toBe('in_progress');
    expect(dto.currentStep).toBe(0);
    expect(dto.answers.frequency).toBeNull();
  });

  it('patchBlock writes to the correct user\'s row when two users have rows', async () => {
    await intakeService.patchBlock('user-1', { block: 'frequency', value: { band: 'lt1' } });
    await intakeService.patchBlock('user-2', { block: 'frequency', value: { band: '15_plus' } });

    await intakeService.patchBlock('user-1', { block: 'triggers', value: { keys: ['stress'], custom: [] } });

    expect(rowsByUser.get('user-1').answers.frequency).toEqual({ band: 'lt1' });
    expect(rowsByUser.get('user-1').answers.triggers).toEqual({ keys: ['stress'], custom: [] });
    expect(rowsByUser.get('user-2').answers.frequency).toEqual({ band: '15_plus' });
    expect(rowsByUser.get('user-2').answers.triggers).toBeNull();
  });

  it('degrades to empty answers when the stored version does not match INTAKE_VERSION', async () => {
    rowsByUser.set('user-3', {
      userId: 'user-3',
      version: INTAKE_VERSION + 1,
      status: 'in_progress',
      currentStep: 2,
      answers: { frequency: { band: '4_7' } },
      seeded: {},
      completedAt: null,
    });

    const dto = await intakeService.get('user-3');

    expect(dto.answers).toEqual({ frequency: null, triggers: null, medications: null, habits: null });
  });

  it('degrades to empty answers when the stored answers jsonb is structurally invalid', async () => {
    rowsByUser.set('user-4', {
      userId: 'user-4',
      version: INTAKE_VERSION,
      status: 'in_progress',
      currentStep: 2,
      answers: { frequency: 'not-an-object' },
      seeded: {},
      completedAt: null,
    });

    const dto = await intakeService.get('user-4');

    expect(dto.answers).toEqual({ frequency: null, triggers: null, medications: null, habits: null });
  });

  it('skip preserves progress made via patchBlock', async () => {
    await intakeService.patchBlock('user-5', { block: 'frequency', value: { band: '1_3' } });
    await intakeService.patchBlock('user-5', { block: 'triggers', value: { keys: ['stress'], custom: [] } });

    const dto = await intakeService.skip('user-5');

    expect(dto.status).toBe('skipped');
    expect(dto.currentStep).toBe(2);
    expect(dto.answers.frequency).toEqual({ band: '1_3' });
    expect(dto.answers.triggers).toEqual({ keys: ['stress'], custom: [] });

    const stored = rowsByUser.get('user-5');

    expect(stored.currentStep).toBe(2);
    expect(stored.answers.frequency).toEqual({ band: '1_3' });
    expect(stored.answers.triggers).toEqual({ keys: ['stress'], custom: [] });
  });

  // Regression guard for the `GREATEST(...)` SQL expression in patchBlock's
  // onConflictDoUpdate set clause. Every other test above drives patchBlock
  // sequentially through its own read-then-write path, so the JS-computed
  // currentStep always equals the stored value by the time the write lands —
  // the GREATEST branch never differs from a plain assignment there. This
  // test forces a genuine stale read: a patch call captures its read (which,
  // per the fake DB above, happens synchronously the moment patchBlock is
  // invoked, before any await yields) while currentStep is still low, then a
  // second, unrelated patch fully commits and advances currentStep higher,
  // and only then does the first (stale) call's write land. If the write
  // path is ever changed from GREATEST to a plain numeric assignment, this
  // stale write would clobber the higher, already-committed value.
  it('does not regress currentStep when a stale-read write commits after a later write already advanced it', async () => {
    await intakeService.patchBlock('user-stale', { block: 'frequency', value: { band: '1_3' } });

    expect(rowsByUser.get('user-stale').currentStep).toBe(1);

    // Both calls are started (not awaited) while currentStep is still 1, so
    // both capture the same stale read. Their internal chains have identical
    // shape (same number of microtask hops), so they resolve in the same
    // batch, in start order: the "winner" (started first) writes first,
    // advancing currentStep from 1 to 4; the "loser" (started second) read
    // the SAME stale currentStep=1, computed a lower target (2), and writes
    // right after — using an outdated value.
    const winner = intakeService.patchBlock('user-stale', { block: 'habits', value: null });
    const staleWrite = intakeService.patchBlock('user-stale', { block: 'triggers', value: { keys: ['stress'], custom: [] } });

    await Promise.all([winner, staleWrite]);

    // The stale write's outdated computed value (max(1, 2) = 2) must not
    // regress the column below the winner's already-committed 4.
    expect(rowsByUser.get('user-stale').currentStep).toBe(4);
  });
});
