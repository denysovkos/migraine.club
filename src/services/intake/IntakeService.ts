import type { IntakeAnswers, IntakeBlockPatch, IntakeStatusType } from '@/models/intake';

import { eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { db } from '@/libs/DB';
import { INTAKE_STEP_ORDER, INTAKE_VERSION, IntakeAnswersSchema, IntakeStatus } from '@/models/intake';
import { intakeResponseSchema } from '@/models/Schema';
import { seedFromIntake } from '@/services/intake/seedFromIntake';
import { getUserTimezone } from '@/services/userTimezone';

export type IntakeDTO = {
  status: IntakeStatusType;
  currentStep: number;
  version: number;
  answers: IntakeAnswers;
  completedAt: string | null;
};

const emptyAnswers = (): IntakeAnswers => IntakeAnswersSchema.parse({});

const notStarted = (): IntakeDTO => ({
  status: IntakeStatus.IN_PROGRESS,
  currentStep: 0,
  version: INTAKE_VERSION,
  answers: emptyAnswers(),
  completedAt: null,
});

/**
 * Parses stored answers against the schema for their version. An unrecognised
 * version is surfaced as empty answers rather than throwing — the wizard renders
 * read-only in that case instead of crashing the dashboard gate.
 */
function parseAnswers(version: number, raw: unknown): IntakeAnswers {
  if (version !== INTAKE_VERSION) {
    return emptyAnswers();
  }
  const result = IntakeAnswersSchema.safeParse(raw ?? {});
  return result.success ? result.data : emptyAnswers();
}

async function readRow(userId: string) {
  const [row] = await db
    .select()
    .from(intakeResponseSchema)
    .where(eq(intakeResponseSchema.userId, userId))
    .limit(1);
  return row ?? null;
}

function toDTO(row: NonNullable<Awaited<ReturnType<typeof readRow>>>): IntakeDTO {
  return {
    status: row.status,
    currentStep: row.currentStep,
    version: row.version,
    answers: parseAnswers(row.version, row.answers),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

async function get(userId: string): Promise<IntakeDTO> {
  const row = await readRow(userId);
  return row ? toDTO(row) : notStarted();
}

async function patchBlock(userId: string, patch: IntakeBlockPatch): Promise<IntakeDTO> {
  const current = await get(userId);
  const answers: IntakeAnswers = { ...current.answers, [patch.block]: patch.value } as IntakeAnswers;
  const blockIndex = INTAKE_STEP_ORDER.indexOf(patch.block);
  const currentStep = Math.max(current.currentStep, blockIndex + 1);

  await db
    .insert(intakeResponseSchema)
    .values({
      userId,
      version: INTAKE_VERSION,
      status: current.status,
      currentStep,
      answers,
      seeded: {},
    })
    .onConflictDoUpdate({
      target: intakeResponseSchema.userId,
      // GREATEST against the row's current value (not the JS `currentStep` we
      // computed from a possibly-stale read) keeps this monotonic even when two
      // PATCHes race: whichever commits second still can't regress the column.
      set: { answers, currentStep: sql`GREATEST(${intakeResponseSchema.currentStep}, excluded.current_step)` },
    });

  return { ...current, answers, currentStep };
}

async function skip(userId: string): Promise<IntakeDTO> {
  const current = await get(userId);
  if (current.status === IntakeStatus.COMPLETED) {
    return current;
  }

  await db
    .insert(intakeResponseSchema)
    .values({
      userId,
      version: INTAKE_VERSION,
      status: IntakeStatus.SKIPPED,
      currentStep: current.currentStep,
      answers: current.answers,
      seeded: {},
    })
    .onConflictDoUpdate({
      target: intakeResponseSchema.userId,
      set: { status: IntakeStatus.SKIPPED },
    });

  return { ...current, status: IntakeStatus.SKIPPED };
}

async function complete(userId: string): Promise<IntakeDTO> {
  // Cheap fast path only — two concurrent POSTs (a double-tap on "Finish")
  // can both pass this check under READ COMMITTED. It is NOT the guarantee;
  // see the row lock below, which is.
  const fastPath = await get(userId);
  if (fastPath.status === IntakeStatus.COMPLETED) {
    return fastPath;
  }

  const timezone = await getUserTimezone(userId);
  const todayYmd = DateTime.now().setZone(timezone).toISODate()!;

  await db.transaction(async (tx) => {
    // Lock the row (if any) for the duration of the transaction so a second,
    // concurrent complete() blocks here instead of racing seedFromIntake's
    // dedupe query against our uncommitted writes. A user who never PATCHed
    // has no row to lock — their answers are empty, so seeding is a no-op
    // either way.
    const [locked] = await tx
      .select()
      .from(intakeResponseSchema)
      .where(eq(intakeResponseSchema.userId, userId))
      .for('update');

    if (locked && locked.status === IntakeStatus.COMPLETED) {
      return;
    }

    const answers = locked ? parseAnswers(locked.version, locked.answers) : emptyAnswers();
    const seeded = await seedFromIntake(tx, { userId, answers, todayYmd });

    await tx
      .insert(intakeResponseSchema)
      .values({
        userId,
        version: INTAKE_VERSION,
        status: IntakeStatus.COMPLETED,
        currentStep: INTAKE_STEP_ORDER.length,
        answers,
        seeded,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: intakeResponseSchema.userId,
        set: {
          status: IntakeStatus.COMPLETED,
          currentStep: INTAKE_STEP_ORDER.length,
          seeded,
          completedAt: new Date(),
        },
      });
  });

  return get(userId);
}

export const intakeService = { get, patchBlock, skip, complete };
