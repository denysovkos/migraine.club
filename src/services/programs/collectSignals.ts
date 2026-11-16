import type { EngineSignals } from './recommendationEngine';
import type { LocalDateString } from '@/services/localDate';

import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { IntakeAnswersSchema } from '@/models/intake';

import {
  acuteDosesSchema,
  dailyDiaryEntrySchema,
  episodeSchema,
  factorEventSchema,
  factorSchema,
  intakeResponseSchema,
} from '@/models/Schema';
import { ymdToDbDate } from '@/services/localDate';

/**
 * Pulls the recommendation-engine inputs from the database for a given user.
 *
 * - factor-event frequency (last 14d) — e.g. sleep_issue
 * - headache-day count from diary (last 14d)
 * - diary coverage (last 28d)
 * - average onset-to-dose minutes across attacks-with-doses (last 28d)
 * - acute-med-days: distinct local dates with at least one acute dose (last 28d)
 */
export async function collectSignals(args: {
  userId: string;
  today: string;
  timezone: string;
}): Promise<EngineSignals> {
  const today = DateTime.fromISO(args.today, { zone: args.timezone });
  const todayYmd = today.toISODate()!;
  const start14Ymd = today.minus({ days: 13 }).toISODate()!;
  const start28Ymd = today.minus({ days: 27 }).toISODate()!;
  const start28UtcMs = today.minus({ days: 28 }).toUTC().toJSDate();

  const [diaryLast14, diaryLast28, factorEvents, attacksLast28, dosesLast28, intakeRows] = await Promise.all([
    db
      .select({ dayType: dailyDiaryEntrySchema.dayType })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(start14Ymd as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(todayYmd as LocalDateString)),
        ),
      ),
    db
      .select({ id: dailyDiaryEntrySchema.id })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(start28Ymd as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(todayYmd as LocalDateString)),
        ),
      ),
    db
      .select({ key: factorSchema.key, occurredAt: factorEventSchema.occurredAt })
      .from(factorEventSchema)
      .innerJoin(factorSchema, eq(factorEventSchema.factorId, factorSchema.id))
      .where(
        and(
          eq(factorEventSchema.userId, args.userId),
          gte(factorEventSchema.occurredAt, today.minus({ days: 14 }).toJSDate()),
        ),
      ),
    db
      .select({
        id: episodeSchema.id,
        startTime: episodeSchema.startTime,
        onsetAt: episodeSchema.onsetAt,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          gte(episodeSchema.startTime, start28UtcMs),
          isNotNull(episodeSchema.startTime),
        ),
      ),
    db
      .select({ takenAt: acuteDosesSchema.takenAt, attackId: acuteDosesSchema.attackId })
      .from(acuteDosesSchema)
      .where(
        and(
          eq(acuteDosesSchema.userId, args.userId),
          gte(acuteDosesSchema.takenAt, start28UtcMs),
        ),
      ),
    db
      .select({ answers: intakeResponseSchema.answers, status: intakeResponseSchema.status })
      .from(intakeResponseSchema)
      .where(eq(intakeResponseSchema.userId, args.userId))
      .limit(1),
  ]);

  const headacheDaysLast14d = diaryLast14.filter(
    r => r.dayType === 'headache_day' || r.dayType === 'migraine_day',
  ).length;

  const diaryCoverageLast28d = diaryLast28.length / 28;

  const factorLogsLast14d = factorEvents
    .filter(r => r.key !== null)
    .map((r) => {
      const daysAgo = Math.floor(today.diff(DateTime.fromJSDate(r.occurredAt), 'days').days);
      return { factor: r.key as string, value: '', daysAgo };
    });

  // Map attack id → earliest dose time
  const earliestDoseByAttack = new Map<number, Date>();
  for (const d of dosesLast28) {
    if (d.attackId === null) {
      continue;
    }
    const prev = earliestDoseByAttack.get(d.attackId);
    if (!prev || d.takenAt < prev) {
      earliestDoseByAttack.set(d.attackId, d.takenAt);
    }
  }

  const deltas: number[] = [];
  for (const a of attacksLast28) {
    const dose = earliestDoseByAttack.get(a.id);
    if (!dose || !a.startTime) {
      continue;
    }
    const onsetTime = a.onsetAt ?? a.startTime;
    const minutes = Math.round((dose.getTime() - onsetTime.getTime()) / 60000);
    if (minutes < 0) {
      continue;
    }
    deltas.push(minutes);
  }
  const avgOnsetToDoseMinutesLast28d = deltas.length === 0
    ? null
    : Math.round(deltas.reduce((s, x) => s + x, 0) / deltas.length);

  // acute-med-days: distinct local dates with ≥ 1 dose taken
  const acuteMedDates = new Set<string>();
  for (const d of dosesLast28) {
    const local = DateTime.fromJSDate(d.takenAt, { zone: args.timezone }).toISODate();
    if (local) {
      acuteMedDates.add(local);
    }
  }

  const intakeRow = intakeRows[0];
  const intakeAnswers
    = intakeRow && intakeRow.status === 'completed'
      ? IntakeAnswersSchema.safeParse(intakeRow.answers ?? {})
      : null;
  const intake
    = intakeAnswers?.success && intakeAnswers.data.habits
      ? {
          sleepTrouble: intakeAnswers.data.habits.sleepTrouble,
          medTiming: intakeAnswers.data.habits.medTiming,
        }
      : null;

  return {
    factorLogsLast14d,
    headacheDaysLast14d,
    diaryCoverageLast28d,
    avgOnsetToDoseMinutesLast28d,
    acuteMedDaysLast28d: acuteMedDates.size,
    intake,
  };
}
