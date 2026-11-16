import type { LocalDateString } from '@/services/localDate';
import type { ComputeOutcomesResult } from '@/services/outcomes/computeOutcomes';

import { and, eq, gte, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import { dailyDiaryEntrySchema, medicationIntakesSchema, medicationsCatalogSchema, userMedicationsSchema, userOutcomeSettingsSchema } from '@/models/Schema';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import {
  computeOutcomesForRange,
  computeResponder50,
  resolveBaselineRange,
  resolveWindowRange,
} from '@/services/outcomes/computeOutcomes';
import { getUserTimezone } from '@/services/userTimezone';

function toUtcJsDateFromLocalDate(args: { date: string; timezone: string }): Date {
  // date is local YYYY-MM-DD; use start-of-day in that timezone and convert to UTC instant
  return DateTime.fromISO(args.date, { zone: args.timezone }).startOf('day').toUTC().toJSDate();
}

function toUtcExclusiveEndFromLocalDate(args: { date: string; timezone: string }): Date {
  // exclusive end = start of next day in timezone converted to UTC instant
  return DateTime.fromISO(args.date, { zone: args.timezone })
    .plus({ days: 1 })
    .startOf('day')
    .toUTC()
    .toJSDate();
}

export class OutcomesService {
  private static readonly RESPONDER_MIN_COVERAGE = 0.8;
  async getTimezoneForUser(userId: string): Promise<string> {
    return await getUserTimezone(userId);
  }

  async getOutcomeSettings(userId: string): Promise<{
    baselineStart: Date | null;
    baselineEnd: Date | null;
    preferredWindowDays: number;
    timezone: string;
  }> {
    const timezone = await this.getTimezoneForUser(userId);

    const [row] = await db
      .select({
        baselineStart: userOutcomeSettingsSchema.baselineStart,
        baselineEnd: userOutcomeSettingsSchema.baselineEnd,
        preferredWindowDays: userOutcomeSettingsSchema.preferredWindowDays,
      })
      .from(userOutcomeSettingsSchema)
      .where(eq(userOutcomeSettingsSchema.userId, userId))
      .limit(1);

    return {
      baselineStart: row?.baselineStart ?? null,
      baselineEnd: row?.baselineEnd ?? null,
      preferredWindowDays: row?.preferredWindowDays ?? 28,
      timezone,
    };
  }

  async upsertOutcomeSettings(args: {
    userId: string;
    baselineStart: Date | null;
    baselineEnd: Date | null;
    preferredWindowDays: number;
    timezone: string | null;
  }): Promise<void> {
    // Drizzle doesn't support "upsert" in a single helper across all dialects; do it explicitly.
    const existing = await db
      .select({ userId: userOutcomeSettingsSchema.userId })
      .from(userOutcomeSettingsSchema)
      .where(eq(userOutcomeSettingsSchema.userId, args.userId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(userOutcomeSettingsSchema).values({
        userId: args.userId,
        baselineStart: args.baselineStart,
        baselineEnd: args.baselineEnd,
        preferredWindowDays: args.preferredWindowDays,
        timezone: args.timezone,
      });
      return;
    }

    await db
      .update(userOutcomeSettingsSchema)
      .set({
        baselineStart: args.baselineStart,
        baselineEnd: args.baselineEnd,
        preferredWindowDays: args.preferredWindowDays,
        timezone: args.timezone,
      })
      .where(eq(userOutcomeSettingsSchema.userId, args.userId));
  }

  async computeOutcomes(args: {
    userId: string;
    from?: string; // YYYY-MM-DD local
    to?: string; // YYYY-MM-DD local
    windowDays?: number;
  }): Promise<ComputeOutcomesResult> {
    const settings = await this.getOutcomeSettings(args.userId);
    const timezone = settings.timezone;
    const windowDays = args.windowDays ?? settings.preferredWindowDays ?? 28;

    const window = (args.from && args.to)
      ? { from: args.from, to: args.to }
      : resolveWindowRange({ timezone, windowDays, to: args.to });

    const rangeStart = toUtcJsDateFromLocalDate({ date: window.from, timezone });
    const rangeEndExclusive = toUtcExclusiveEndFromLocalDate({ date: window.to, timezone });

    const diaryRows = await db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(window.from as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(window.to as LocalDateString)),
        ),
      );

    const diaryDays = diaryRows.map(r => ({
      localDate: dbDateToYmd(r.localDate),
      dayType: (r.dayType as any) as 'headache_free' | 'headache_day' | 'migraine_day',
    }));

    // Medication intakes are the source of truth for medication tracking (normalized table).
    const intakes = await db
      .select({
        takenAt: medicationIntakesSchema.takenAt,
        medicationName: medicationIntakesSchema.medicationName,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(medicationIntakesSchema)
      .leftJoin(
        userMedicationsSchema,
        eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id),
      )
      .leftJoin(
        medicationsCatalogSchema,
        eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
      )
      .where(
        and(
          eq(medicationIntakesSchema.userId, args.userId),
          gte(medicationIntakesSchema.takenAt, rangeStart),
          lt(medicationIntakesSchema.takenAt, rangeEndExclusive),
        ),
      );

    const intakeEvents: Array<{ takenAt: Date; name: string }> = intakes
      .map((r) => {
        const name = (r.medicationName ?? r.customName ?? r.canonicalName ?? '').trim();
        if (!name) {
          return null;
        }
        return { takenAt: r.takenAt, name };
      })
      .filter(Boolean) as any;

    const current = computeOutcomesForRange({
      timezone,
      windowDays,
      from: window.from,
      to: window.to,
      diaryDays,
      medicationIntakes: intakeEvents,
    });

    const baselineRange = resolveBaselineRange({
      timezone,
      windowDays,
      baselineStart: settings.baselineStart,
      baselineEnd: settings.baselineEnd,
    });

    if (!baselineRange) {
      return current;
    }

    const baselineDiaryRows = await db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(baselineRange.from as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(baselineRange.to as LocalDateString)),
        ),
      );

    const baselineDiaryDays = baselineDiaryRows.map(r => ({
      localDate: dbDateToYmd(r.localDate),
      dayType: (r.dayType as any) as 'headache_free' | 'headache_day' | 'migraine_day',
    }));

    const baseline = computeOutcomesForRange({
      timezone,
      windowDays,
      from: baselineRange.from,
      to: baselineRange.to,
      diaryDays: baselineDiaryDays,
      medicationIntakes: [],
    });

    return {
      ...current,
      baseline: {
        from: baselineRange.from,
        to: baselineRange.to,
        mmd: baseline.totals.mmdMin,
        mhd: baseline.totals.mhdMin,
      },
      responder50: (() => {
        const curCoverage = current.totals.coverage.recordedDays / Math.max(1, current.totals.coverage.totalDays);
        const baseCoverage = baseline.totals.coverage.recordedDays / Math.max(1, baseline.totals.coverage.totalDays);
        if (
          curCoverage < OutcomesService.RESPONDER_MIN_COVERAGE
          || baseCoverage < OutcomesService.RESPONDER_MIN_COVERAGE
        ) {
          return { status: 'NA' as const, reason: 'INSUFFICIENT_COVERAGE' as const };
        }
        return computeResponder50({
          baselineMmd: baseline.totals.mmdMin,
          currentMmd: current.totals.mmdMin,
        });
      })(),
    };
  }

  async computeMonthly(args: { userId: string; months: number }): Promise<{
    timezone: string;
    months: Array<{
      month: string;
      mmd: number;
      mmdMax: number;
      mhd: number;
      mhdMax: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
    }>;
  }> {
    const timezone = await this.getTimezoneForUser(args.userId);
    const months = Math.max(1, Math.min(36, args.months));

    const endMonth = DateTime.now().setZone(timezone).startOf('month');
    const startMonth = endMonth.minus({ months: months - 1 });

    const rangeStart = startMonth.toUTC().toJSDate();
    const rangeEndExclusive = endMonth.plus({ months: 1 }).toUTC().toJSDate();

    const intakes = await db
      .select({
        takenAt: medicationIntakesSchema.takenAt,
        medicationName: medicationIntakesSchema.medicationName,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(medicationIntakesSchema)
      .leftJoin(
        userMedicationsSchema,
        eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id),
      )
      .leftJoin(
        medicationsCatalogSchema,
        eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
      )
      .where(
        and(
          eq(medicationIntakesSchema.userId, args.userId),
          gte(medicationIntakesSchema.takenAt, rangeStart),
          lt(medicationIntakesSchema.takenAt, rangeEndExclusive),
        ),
      );

    const intakeEvents: Array<{ takenAt: Date; name: string }> = intakes
      .map((r) => {
        const name = (r.medicationName ?? r.customName ?? r.canonicalName ?? '').trim();
        if (!name) {
          return null;
        }
        return { takenAt: r.takenAt, name };
      })
      .filter(Boolean) as any;

    const diaryRows = await db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(startMonth.toISODate()! as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(endMonth.endOf('month').toISODate()! as LocalDateString)),
        ),
      );

    const diaryDaysAll = diaryRows.map(r => ({
      localDate: dbDateToYmd(r.localDate),
      dayType: (r.dayType as any) as 'headache_free' | 'headache_day' | 'migraine_day',
    }));

    const out: Array<{
      month: string;
      mmd: number;
      mmdMax: number;
      mhd: number;
      mhdMax: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
    }> = [];

    for (let i = 0; i < months; i++) {
      const monthStart = startMonth.plus({ months: i });
      const monthEnd = monthStart.endOf('month');
      const from = monthStart.toISODate()!;
      const to = monthEnd.toISODate()!;

      // Filter in-memory; ranges are already bounded to the overall window.
      const mStartUtc = monthStart.toUTC().toJSDate();
      const mEndExclusiveUtc = monthStart.plus({ months: 1 }).toUTC().toJSDate();

      const monthMeds = intakeEvents.filter(m => m.takenAt >= mStartUtc && m.takenAt < mEndExclusiveUtc);

      const computed = computeOutcomesForRange({
        timezone,
        windowDays: 0, // not used for monthly, but required by shape
        from,
        to,
        diaryDays: diaryDaysAll.filter(e => e.localDate >= from && e.localDate <= to),
        medicationIntakes: monthMeds,
      });

      out.push({
        month: monthStart.toFormat('yyyy-MM'),
        mmd: computed.totals.mmdMin,
        mmdMax: computed.totals.mmdMax,
        mhd: computed.totals.mhdMin,
        mhdMax: computed.totals.mhdMax,
        acuteMedicationDays: computed.totals.acuteMedicationDays,
        coverage: computed.totals.coverage,
      });
    }

    return { timezone, months: out };
  }
}

export const outcomesService = new OutcomesService();
