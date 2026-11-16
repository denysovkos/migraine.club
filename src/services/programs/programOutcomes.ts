import type { EnrollmentDTO } from './programEnrollmentService';

import type { LocalDateString } from '@/services/localDate';
import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { db } from '@/libs/DB';

import {
  dailyDiaryEntrySchema,
  programAdherenceEventSchema,
} from '@/models/Schema';
import { ymdToDbDate } from '@/services/localDate';

export type WindowSummary = { headacheDays: number; totalDays: number };

export type OutcomeComparison = {
  baseline: WindowSummary;
  evaluation: WindowSummary;
  percentChange: number;
  directionLabel: 'reduced' | 'increased' | 'no_change';
};

export function combineOutcomeWindows(args: {
  baseline: WindowSummary;
  evaluation: WindowSummary;
}): OutcomeComparison {
  const { baseline, evaluation } = args;
  if (baseline.headacheDays === 0) {
    return {
      baseline,
      evaluation,
      percentChange: 0,
      directionLabel: evaluation.headacheDays === 0 ? 'no_change' : 'increased',
    };
  }
  const change = (evaluation.headacheDays - baseline.headacheDays) / baseline.headacheDays;
  const direction: OutcomeComparison['directionLabel']
    = change < -0.01 ? 'reduced' : change > 0.01 ? 'increased' : 'no_change';
  return { baseline, evaluation, percentChange: change, directionLabel: direction };
}

async function countHeadacheDays(userId: string, start: string, end: string): Promise<number> {
  const rows = await db
    .select({ dayType: dailyDiaryEntrySchema.dayType })
    .from(dailyDiaryEntrySchema)
    .where(
      and(
        eq(dailyDiaryEntrySchema.userId, userId),
        gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(start as LocalDateString)),
        lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(end as LocalDateString)),
      ),
    );
  return rows.filter(r => r.dayType === 'headache_day' || r.dayType === 'migraine_day').length;
}

async function countCoverageDays(userId: string, start: string, end: string): Promise<number> {
  const rows = await db
    .select({ id: dailyDiaryEntrySchema.id })
    .from(dailyDiaryEntrySchema)
    .where(
      and(
        eq(dailyDiaryEntrySchema.userId, userId),
        gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(start as LocalDateString)),
        lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(end as LocalDateString)),
      ),
    );
  return rows.length;
}

function daysBetweenInclusive(a: string, b: string): number {
  const startMs = new Date(`${a}T00:00:00Z`).getTime();
  const endMs = new Date(`${b}T00:00:00Z`).getTime();
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

export type ProgramProgressSummary = {
  adherence: number;
  coverage: number;
  evalComplete: boolean;
  evalDaysPassed: number;
  baselineCoverage: number;
  comparison: OutcomeComparison;
};

export async function getSleepProgressSummary(args: {
  userId: string;
  enrollment: EnrollmentDTO;
  today: string;
}): Promise<ProgramProgressSummary> {
  return getProgressSummary({ ...args, perAttack: false });
}

export async function getAcuteProgressSummary(args: {
  userId: string;
  enrollment: EnrollmentDTO;
  today: string;
}): Promise<ProgramProgressSummary> {
  return getProgressSummary({ ...args, perAttack: true });
}

async function getProgressSummary(args: {
  userId: string;
  enrollment: EnrollmentDTO;
  today: string;
  perAttack: boolean;
}): Promise<ProgramProgressSummary> {
  const { userId, enrollment, today, perAttack } = args;
  const inEval = today >= enrollment.evaluationWindowStart;
  const evalEnd = today < enrollment.evaluationWindowEnd ? today : enrollment.evaluationWindowEnd;

  const adherenceFilter = perAttack
    ? isNotNull(programAdherenceEventSchema.attackId)
    : isNull(programAdherenceEventSchema.attackId);

  const [baselineHd, baselineCov, evalHd, evalCov, adherenceRows] = await Promise.all([
    countHeadacheDays(userId, enrollment.baselineWindowStart, enrollment.baselineWindowEnd),
    countCoverageDays(userId, enrollment.baselineWindowStart, enrollment.baselineWindowEnd),
    inEval ? countHeadacheDays(userId, enrollment.evaluationWindowStart, evalEnd) : Promise.resolve(0),
    inEval ? countCoverageDays(userId, enrollment.evaluationWindowStart, evalEnd) : Promise.resolve(0),
    db
      .select({ signal: programAdherenceEventSchema.signal })
      .from(programAdherenceEventSchema)
      .where(
        and(
          eq(programAdherenceEventSchema.enrollmentId, enrollment.id),
          adherenceFilter,
        ),
      ),
  ]);

  const due = adherenceRows.filter(r => r.signal !== 'na').length;
  const hits = adherenceRows.filter(r => r.signal === 'hit').length;
  const adherence = due === 0 ? 0 : hits / due;

  const evalDaysPassed = inEval ? Math.max(0, Math.min(28, daysBetweenInclusive(enrollment.evaluationWindowStart, evalEnd))) : 0;
  const evalComplete = today >= enrollment.evaluationWindowEnd;
  const coverage = evalComplete
    ? evalCov / 28
    : evalDaysPassed === 0
      ? 0
      : evalCov / evalDaysPassed;

  const comparison = combineOutcomeWindows({
    baseline: { headacheDays: baselineHd, totalDays: 28 },
    evaluation: { headacheDays: evalHd, totalDays: evalDaysPassed || 28 },
  });

  return {
    adherence,
    coverage,
    evalComplete,
    evalDaysPassed,
    baselineCoverage: baselineCov / 28,
    comparison,
  };
}
