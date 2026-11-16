import type { ProgramEnrollmentStatus, ProgramTargetPayload } from '@/models/Schema';
import { and, eq } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  programEnrollmentSchema,
} from '@/models/Schema';

import { computeEnrollmentWindows } from './enrollmentWindows';
import { getProgramDefinition } from './programDefinitions';

export type EnrollmentDTO = {
  id: number;
  userId: string;
  programId: string;
  status: ProgramEnrollmentStatus;
  targetPayload: ProgramTargetPayload;
  startDate: string;
  endDate: string | null;
  baselineWindowStart: string;
  baselineWindowEnd: string;
  evaluationWindowStart: string;
  evaluationWindowEnd: string;
  rampDays: number;
  timezone: string;
};

function rowToDto(row: typeof programEnrollmentSchema.$inferSelect): EnrollmentDTO {
  return {
    id: row.id,
    userId: row.userId,
    programId: row.programId,
    status: row.status,
    targetPayload: row.targetPayload,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    baselineWindowStart: row.baselineWindowStart,
    baselineWindowEnd: row.baselineWindowEnd,
    evaluationWindowStart: row.evaluationWindowStart,
    evaluationWindowEnd: row.evaluationWindowEnd,
    rampDays: row.rampDays,
    timezone: row.timezone,
  };
}

async function enroll(args: {
  userId: string;
  programId: string;
  targetPayload: ProgramTargetPayload;
  timezone: string;
  today: string; // YYYY-MM-DD
}): Promise<EnrollmentDTO> {
  if (!getProgramDefinition(args.programId)) {
    throw new Error(`Unknown program: ${args.programId}`);
  }

  const existing = await db
    .select()
    .from(programEnrollmentSchema)
    .where(
      and(
        eq(programEnrollmentSchema.userId, args.userId),
        eq(programEnrollmentSchema.programId, args.programId),
        eq(programEnrollmentSchema.status, 'active'),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error('User already enrolled in this program');
  }

  const windows = computeEnrollmentWindows({ startDate: args.today, timezone: args.timezone });

  const [row] = await db
    .insert(programEnrollmentSchema)
    .values({
      userId: args.userId,
      programId: args.programId,
      status: 'active',
      targetPayload: args.targetPayload,
      startDate: args.today,
      baselineWindowStart: windows.baselineWindowStart,
      baselineWindowEnd: windows.baselineWindowEnd,
      evaluationWindowStart: windows.evaluationWindowStart,
      evaluationWindowEnd: windows.evaluationWindowEnd,
      rampDays: windows.rampDays,
      timezone: args.timezone,
    })
    .returning();

  return rowToDto(row!);
}

async function setStatus(args: {
  userId: string;
  enrollmentId: number;
  status: ProgramEnrollmentStatus;
  endDate?: string;
}): Promise<EnrollmentDTO> {
  const [row] = await db
    .update(programEnrollmentSchema)
    .set({
      status: args.status,
      endDate: args.status === 'ended'
        ? args.endDate ?? DateTime.now().toISODate()!
        : undefined,
    })
    .where(
      and(eq(programEnrollmentSchema.id, args.enrollmentId), eq(programEnrollmentSchema.userId, args.userId)),
    )
    .returning();

  if (!row) {
    throw new Error('Enrollment not found');
  }
  return rowToDto(row);
}

async function listForUser(userId: string): Promise<EnrollmentDTO[]> {
  const rows = await db
    .select()
    .from(programEnrollmentSchema)
    .where(eq(programEnrollmentSchema.userId, userId));
  return rows.map(rowToDto);
}

async function getActive(userId: string, programId: string): Promise<EnrollmentDTO | null> {
  const [row] = await db
    .select()
    .from(programEnrollmentSchema)
    .where(
      and(
        eq(programEnrollmentSchema.userId, userId),
        eq(programEnrollmentSchema.programId, programId),
        eq(programEnrollmentSchema.status, 'active'),
      ),
    )
    .limit(1);
  return row ? rowToDto(row) : null;
}

export const programEnrollmentService = {
  enroll,
  pause: (a: { userId: string; enrollmentId: number }) => setStatus({ ...a, status: 'paused' }),
  resume: (a: { userId: string; enrollmentId: number }) => setStatus({ ...a, status: 'active' }),
  end: (a: { userId: string; enrollmentId: number; endDate?: string }) => setStatus({ ...a, status: 'ended' }),
  listForUser,
  getActive,
};
