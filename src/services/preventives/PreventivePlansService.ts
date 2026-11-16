import type { LocalDateString } from '@/services/localDate';
import type {
  CreatePreventivePlanInput,
  PreventiveIntakeStateType,
  PreventiveIntakeUpsertInput,
  PreventivePlanStatusType,
  PreventiveSchedulePayload,
  PreventiveStopReasonType,
  PreventiveWeeklyCheckInInput,
  UpdatePreventivePlanInput,
} from '@/types/Preventives';

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  dailyDiaryEntrySchema,
  medicationIntakesSchema,
  medicationsCatalogSchema,
  preventiveIntakeEventSchema,
  preventivePlanSchema,
  preventiveStatusChangeSchema,
  preventiveWeeklyCheckInSchema,
  userMedicationsSchema,
} from '@/models/Schema';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { computeOutcomesForRange, computeResponder50 } from '@/services/outcomes/computeOutcomes';
import { toLocalISODate } from '@/services/outcomes/localDateOverlap';
import { BASELINE_DAYS, EVAL_DAYS, EXTENDED_EVAL_DAYS, resolvePlanWindows } from '@/services/preventives/metrics';
import { getUserTimezone } from '@/services/userTimezone';
import { PreventiveIntakeState } from '@/types/Preventives';

import { getDueStatus, resolveAdherenceForRange, scheduleLabel } from './schedule';

function toUtcStart(date: string, timezone: string): Date {
  return DateTime.fromISO(date, { zone: timezone }).startOf('day').toUTC().toJSDate();
}

function toUtcExclusiveEnd(date: string, timezone: string): Date {
  return DateTime.fromISO(date, { zone: timezone }).plus({ days: 1 }).startOf('day').toUTC().toJSDate();
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const DEFAULT_TIMEZONE = 'Europe/Berlin';
function resolveTimezone(tz: string): string {
  return tz === 'UTC' ? DEFAULT_TIMEZONE : tz;
}

export class PreventivePlansService {
  async listPlans(userId: string): Promise<Array<{
    id: string;
    name: string;
    kind: string;
    doseText: string | null;
    scheduleType: string;
    schedulePayload: PreventiveSchedulePayload;
    scheduleLabel: string;
    startDate: LocalDateString;
    status: PreventivePlanStatusType;
    pausedAt: string | null;
    stoppedAt: string | null;
    stopReason: string | null;
    stopReasonNote: string | null;
    createdAt: string;
    updatedAt: string;
    reminderTimes: string[];
    remindersEnabled: boolean;
    isDuplicateName: boolean;
  }>> {
    const rows = await db
      .select({
        id: preventivePlanSchema.id,
        name: preventivePlanSchema.name,
        kind: preventivePlanSchema.kind,
        doseText: preventivePlanSchema.doseText,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        status: preventivePlanSchema.status,
        pausedAt: preventivePlanSchema.pausedAt,
        stoppedAt: preventivePlanSchema.stoppedAt,
        stopReason: preventivePlanSchema.stopReason,
        stopReasonNote: preventivePlanSchema.stopReasonNote,
        createdAt: preventivePlanSchema.createdAt,
        updatedAt: preventivePlanSchema.updatedAt,
        reminderTimes: preventivePlanSchema.reminderTimes,
        remindersEnabled: preventivePlanSchema.remindersEnabled,
      })
      .from(preventivePlanSchema)
      .where(eq(preventivePlanSchema.userId, userId))
      .orderBy(desc(preventivePlanSchema.createdAt));

    const nameCounts = new Map<string, number>();
    for (const row of rows) {
      const key = normalizeName(row.name);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }

    return rows.map((row) => {
      const startDate = dbDateToYmd(row.startDate);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind as string,
        doseText: row.doseText ?? null,
        scheduleType: row.scheduleType as string,
        schedulePayload: row.schedulePayload as PreventiveSchedulePayload,
        scheduleLabel: scheduleLabel({
          id: row.id,
          kind: row.kind as any,
          scheduleType: row.scheduleType as any,
          schedulePayload: row.schedulePayload as PreventiveSchedulePayload,
          startDate,
          status: row.status as any,
        }),
        startDate,
        status: row.status as PreventivePlanStatusType,
        pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
        stoppedAt: row.stoppedAt ? row.stoppedAt.toISOString() : null,
        stopReason: row.stopReason ?? null,
        stopReasonNote: row.stopReasonNote ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        reminderTimes: row.reminderTimes ?? [],
        remindersEnabled: row.remindersEnabled,
        isDuplicateName: (nameCounts.get(normalizeName(row.name)) ?? 0) > 1,
      };
    });
  }

  async createPlan(
    userId: string,
    input: CreatePreventivePlanInput,
    tx: { insert: typeof db.insert } = db,
  ): Promise<{ id: string }> {
    const [created] = await tx
      .insert(preventivePlanSchema)
      .values({
        userId,
        catalogMedicationId: input.catalogMedicationId ?? null,
        name: input.name.trim(),
        kind: input.kind,
        doseText: input.doseText?.trim() ?? null,
        scheduleType: input.scheduleType,
        schedulePayload: (input.schedulePayload ?? {}) as any,
        startDate: ymdToDbDate(input.startDate as LocalDateString),
        reminderTimes: input.reminderTimes ?? [],
        remindersEnabled: input.remindersEnabled ?? false,
        status: 'active',
        pausedAt: null,
        stoppedAt: null,
        stopReason: null,
        stopReasonNote: null,
      })
      .returning({ id: preventivePlanSchema.id });

    if (!created) {
      throw new Error('Failed to create preventive plan');
    }

    return { id: created.id };
  }

  async updatePlan(args: { userId: string; planId: string; patch: UpdatePreventivePlanInput }): Promise<void> {
    const [existing] = await db
      .select({ id: preventivePlanSchema.id })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.id, args.planId)))
      .limit(1);

    if (!existing) {
      throw new Error('Preventive plan not found');
    }

    await db
      .update(preventivePlanSchema)
      .set({
        name: args.patch.name?.trim(),
        kind: args.patch.kind,
        doseText: Object.hasOwn(args.patch, 'doseText')
          ? (args.patch.doseText?.trim() ?? null)
          : undefined,
        scheduleType: args.patch.scheduleType,
        schedulePayload: Object.hasOwn(args.patch, 'schedulePayload')
          ? (args.patch.schedulePayload ?? {})
          : undefined,
        startDate: args.patch.startDate ? ymdToDbDate(args.patch.startDate as LocalDateString) : undefined,
        reminderTimes: args.patch.reminderTimes,
        remindersEnabled: args.patch.remindersEnabled,
        updatedAt: new Date(),
      })
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.id, args.planId)));
  }

  async setStatus(args: {
    userId: string;
    planId: string;
    nextStatus: PreventivePlanStatusType;
    reason?: PreventiveStopReasonType | null;
    reasonNote?: string | null;
  }): Promise<void> {
    const [row] = await db
      .select({
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.id, args.planId)))
      .limit(1);

    if (!row) {
      throw new Error('Preventive plan not found');
    }

    const prev = row.status as PreventivePlanStatusType;
    if (prev === args.nextStatus) {
      return;
    }

    const now = new Date();
    await db
      .update(preventivePlanSchema)
      .set({
        status: args.nextStatus,
        pausedAt: args.nextStatus === 'paused' ? now : null,
        stoppedAt: args.nextStatus === 'stopped' ? now : null,
        stopReason: args.nextStatus === 'stopped' ? (args.reason ?? null) : null,
        stopReasonNote: args.nextStatus === 'stopped' ? (args.reasonNote ?? null) : null,
        updatedAt: now,
      })
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.id, args.planId)));

    await db
      .insert(preventiveStatusChangeSchema)
      .values({
        userId: args.userId,
        planId: args.planId,
        fromStatus: prev,
        toStatus: args.nextStatus,
        changedAt: now,
        reason: args.reason ?? null,
        reasonNote: args.reasonNote ?? null,
      });
  }

  async deletePlan(userId: string, planId: string): Promise<void> {
    await db
      .delete(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, userId), eq(preventivePlanSchema.id, planId)));
  }

  async upsertIntake(userId: string, input: PreventiveIntakeUpsertInput): Promise<void> {
    const [plan] = await db
      .select({
        id: preventivePlanSchema.id,
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, userId), eq(preventivePlanSchema.id, input.planId)))
      .limit(1);

    if (!plan) {
      throw new Error('Preventive plan not found');
    }
    if (plan.status === 'stopped') {
      throw new Error('Preventive plan is stopped');
    }

    const takenAt = input.state === PreventiveIntakeState.TAKEN ? new Date() : null;
    const values = {
      userId,
      planId: input.planId,
      localDate: ymdToDbDate(input.localDate as LocalDateString),
      state: input.state,
      takenAt,
      note: input.note?.trim() ?? null,
      createdAt: new Date(),
    };

    await db
      .insert(preventiveIntakeEventSchema)
      .values(values)
      .onConflictDoUpdate({
        target: [preventiveIntakeEventSchema.planId, preventiveIntakeEventSchema.localDate],
        set: values as any,
      });
  }

  async createWeeklyCheckIn(userId: string, input: PreventiveWeeklyCheckInInput): Promise<void> {
    const [plan] = await db
      .select({ id: preventivePlanSchema.id })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, userId), eq(preventivePlanSchema.id, input.planId)))
      .limit(1);

    if (!plan) {
      throw new Error('Preventive plan not found');
    }

    await db
      .insert(preventiveWeeklyCheckInSchema)
      .values({
        userId,
        planId: input.planId,
        weekStartLocalDate: ymdToDbDate(input.weekStartLocalDate as LocalDateString),
        sideEffects: input.sideEffects,
        stillTaking: input.stillTaking,
        note: input.note?.trim() ?? null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [preventiveWeeklyCheckInSchema.planId, preventiveWeeklyCheckInSchema.weekStartLocalDate],
        set: {
          sideEffects: input.sideEffects,
          stillTaking: input.stillTaking,
          note: input.note?.trim() ?? null,
        },
      });
  }

  async getDuePlans(args: { userId: string; localDate?: string }): Promise<{
    timezone: string;
    todayLocalDate: LocalDateString;
    due: Array<{
      id: string;
      name: string;
      kind: string;
      scheduleLabel: string;
      isOverdue: boolean;
      state: PreventiveIntakeStateType | null;
    }>;
    notDue: Array<{
      id: string;
      name: string;
      kind: string;
      scheduleLabel: string;
    }>;
    hasActivePlans: boolean;
  }> {
    const timezone = resolveTimezone(await getUserTimezone(args.userId));
    const todayLocalDate = (args.localDate
      ? DateTime.fromISO(args.localDate, { zone: timezone })
      : DateTime.now().setZone(timezone)).toISODate()! as LocalDateString;

    const plans = await db
      .select({
        id: preventivePlanSchema.id,
        name: preventivePlanSchema.name,
        kind: preventivePlanSchema.kind,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.status, 'active')))
      .orderBy(preventivePlanSchema.createdAt);

    if (plans.length === 0) {
      return { timezone, todayLocalDate, due: [], notDue: [], hasActivePlans: false };
    }

    const planIds = plans.map(p => p.id);
    const windowStart = DateTime.fromISO(todayLocalDate, { zone: timezone }).minus({ days: 7 }).toISODate()!;
    const windowEnd = DateTime.fromISO(todayLocalDate, { zone: timezone }).plus({ days: 7 }).toISODate()!;

    const events = await db
      .select({
        planId: preventiveIntakeEventSchema.planId,
        localDate: preventiveIntakeEventSchema.localDate,
        state: preventiveIntakeEventSchema.state,
      })
      .from(preventiveIntakeEventSchema)
      .where(
        and(
          eq(preventiveIntakeEventSchema.userId, args.userId),
          inArray(preventiveIntakeEventSchema.planId, planIds),
          gte(preventiveIntakeEventSchema.localDate, ymdToDbDate(windowStart as LocalDateString)),
          lte(preventiveIntakeEventSchema.localDate, ymdToDbDate(windowEnd as LocalDateString)),
        ),
      );

    const eventsByPlan = new Map<string, Array<{ localDate: LocalDateString; state: any }>>();
    for (const e of events) {
      const list = eventsByPlan.get(e.planId) ?? [];
      list.push({
        localDate: dbDateToYmd(e.localDate),
        state: e.state as any,
      });
      eventsByPlan.set(e.planId, list);
    }

    const due: Array<{
      id: string;
      name: string;
      kind: string;
      scheduleLabel: string;
      isOverdue: boolean;
      state: PreventiveIntakeStateType | null;
    }> = [];
    const notDue: Array<{ id: string; name: string; kind: string; scheduleLabel: string }> = [];

    for (const plan of plans) {
      const startDate = dbDateToYmd(plan.startDate);
      const planLite = {
        id: plan.id,
        kind: plan.kind as any,
        scheduleType: plan.scheduleType as any,
        schedulePayload: plan.schedulePayload as PreventiveSchedulePayload,
        startDate,
        status: plan.status as any,
      };
      const planEvents = eventsByPlan.get(plan.id) ?? [];
      const status = getDueStatus({
        plan: planLite,
        localDate: todayLocalDate,
        timezone,
        events: planEvents,
      });
      const label = scheduleLabel(planLite);
      if (status.isDue || status.isOverdue) {
        due.push({
          id: plan.id,
          name: plan.name,
          kind: plan.kind as string,
          scheduleLabel: label,
          isOverdue: status.isOverdue,
          state: status.matchedEvent?.state ?? null,
        });
      } else {
        notDue.push({
          id: plan.id,
          name: plan.name,
          kind: plan.kind as string,
          scheduleLabel: label,
        });
      }
    }

    return {
      timezone,
      todayLocalDate,
      due,
      notDue,
      hasActivePlans: plans.length > 0,
    };
  }

  async getPlanSummary(args: { userId: string; planId: string }): Promise<{
    timezone: string;
    plan: {
      id: string;
      name: string;
      kind: string;
      doseText: string | null;
      scheduleLabel: string;
      scheduleType: string;
      schedulePayload: PreventiveSchedulePayload;
      startDate: LocalDateString;
      status: PreventivePlanStatusType;
      reminderTimes: string[];
      remindersEnabled: boolean;
    };
    baseline: {
      from: LocalDateString;
      to: LocalDateString;
      mmd: number;
      mhd: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
    } | null;
    evaluation: {
      from: LocalDateString;
      to: LocalDateString;
      mmd: number;
      mhd: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
      percentChangeMmd: number | null;
      responder50: 'YES' | 'NO' | 'NA' | 'NOT_ENOUGH_DATA';
      missingDaysNeeded: number;
    } | null;
    evaluationLong: {
      from: LocalDateString;
      to: LocalDateString;
      mmd: number;
      mhd: number;
      acuteMedicationDays: number;
      coverage: { totalDays: number; recordedDays: number; missingDays: number };
    } | null;
    adherence: {
      last7: { dueDays: number; taken: number; missed: number; unsure: number; coverage: number };
      last28: { dueDays: number; taken: number; missed: number; unsure: number; coverage: number };
    };
    timelineWeeks: Array<{
      weekStart: LocalDateString;
      migraineDays: number;
      adherence: number | null;
    }>;
  }> {
    const timezone = resolveTimezone(await getUserTimezone(args.userId));
    const [plan] = await db
      .select({
        id: preventivePlanSchema.id,
        name: preventivePlanSchema.name,
        kind: preventivePlanSchema.kind,
        doseText: preventivePlanSchema.doseText,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        status: preventivePlanSchema.status,
        reminderTimes: preventivePlanSchema.reminderTimes,
        remindersEnabled: preventivePlanSchema.remindersEnabled,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.id, args.planId)))
      .limit(1);

    if (!plan) {
      throw new Error('Preventive plan not found');
    }

    const startDate = dbDateToYmd(plan.startDate);
    const todayLocalDate = DateTime.now().setZone(timezone).toISODate()! as LocalDateString;

    const {
      baselineFrom,
      baselineTo,
      evalFrom,
      evalTo,
      evalLongTo,
      evalEnd,
      evalLongEnd,
      hasEvalData,
    } = resolvePlanWindows({ startDate, timezone, todayLocalDate });

    const maxTo = todayLocalDate > evalLongTo ? todayLocalDate : evalLongTo;
    const minFrom = baselineFrom;

    const diaryRows = await db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(minFrom as LocalDateString)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(maxTo as LocalDateString)),
        ),
      );

    const diaryDays = diaryRows.map(r => ({
      localDate: dbDateToYmd(r.localDate),
      dayType: (r.dayType as any) as 'headache_free' | 'headache_day' | 'migraine_day',
    }));

    const intakes = await db
      .select({
        takenAt: medicationIntakesSchema.takenAt,
        medicationName: medicationIntakesSchema.medicationName,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(medicationIntakesSchema)
      .leftJoin(userMedicationsSchema, eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id))
      .leftJoin(medicationsCatalogSchema, eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id))
      .where(
        and(
          eq(medicationIntakesSchema.userId, args.userId),
          gte(medicationIntakesSchema.takenAt, toUtcStart(minFrom, timezone)),
          lt(medicationIntakesSchema.takenAt, toUtcExclusiveEnd(maxTo, timezone)),
        ),
      );

    const medicationIntakeEvents = intakes
      .map((r) => {
        const name = (r.medicationName ?? r.customName ?? r.canonicalName ?? '').trim();
        return { takenAt: r.takenAt, name: name || undefined };
      })
      .filter(Boolean) as Array<{ takenAt: Date; name?: string }>;

    const baseline = computeOutcomesForRange({
      timezone,
      windowDays: BASELINE_DAYS,
      from: baselineFrom,
      to: baselineTo,
      diaryDays: diaryDays.filter(d => d.localDate >= baselineFrom && d.localDate <= baselineTo),
      medicationIntakes: [],
    });

    const evaluation = hasEvalData
      ? computeOutcomesForRange({
          timezone,
          windowDays: EVAL_DAYS,
          from: evalFrom,
          to: evalEnd,
          diaryDays: diaryDays.filter(d => d.localDate >= evalFrom && d.localDate <= evalEnd),
          medicationIntakes: medicationIntakeEvents.filter((e) => {
            const local = toLocalISODate({ instant: e.takenAt, timezone });
            return local >= evalFrom && local <= evalEnd;
          }),
        })
      : null;

    const evaluationLong = evalLongEnd >= evalFrom
      ? computeOutcomesForRange({
          timezone,
          windowDays: EXTENDED_EVAL_DAYS,
          from: evalFrom,
          to: evalLongEnd,
          diaryDays: diaryDays.filter(d => d.localDate >= evalFrom && d.localDate <= evalLongEnd),
          medicationIntakes: medicationIntakeEvents.filter((e) => {
            const local = toLocalISODate({ instant: e.takenAt, timezone });
            return local >= evalFrom && local <= evalLongEnd;
          }),
        })
      : null;

    const responder = (() => {
      if (!evaluation) {
        return { status: 'NOT_ENOUGH_DATA' as const, missingDays: EVAL_DAYS };
      }
      const pendingDays = Math.max(
        0,
        Math.round(DateTime.fromISO(evalTo).diff(DateTime.fromISO(evalEnd), 'days').days),
      );
      const missingCoverage = evaluation.totals.coverage.totalDays - evaluation.totals.coverage.recordedDays;
      if (missingCoverage > 0 || pendingDays > 0) {
        return { status: 'NOT_ENOUGH_DATA' as const, missingDays: missingCoverage + pendingDays };
      }
      const result = computeResponder50({
        baselineMmd: baseline.totals.mmdMin,
        currentMmd: evaluation.totals.mmdMin,
      });
      return { status: result.status as 'YES' | 'NO' | 'NA', missingDays: 0 };
    })();

    const percentChange = (() => {
      if (!evaluation) {
        return null;
      }
      if (baseline.totals.mmdMin === 0) {
        return null;
      }
      return (evaluation.totals.mmdMin - baseline.totals.mmdMin) / baseline.totals.mmdMin;
    })();

    const planLite = {
      id: plan.id,
      kind: plan.kind as any,
      scheduleType: plan.scheduleType as any,
      schedulePayload: plan.schedulePayload as PreventiveSchedulePayload,
      startDate,
      status: plan.status as any,
    };

    const last7From = DateTime.fromISO(todayLocalDate).minus({ days: 6 }).toISODate()! as LocalDateString;
    const last28From = DateTime.fromISO(todayLocalDate).minus({ days: 27 }).toISODate()! as LocalDateString;

    const intakeRows = await db
      .select({
        localDate: preventiveIntakeEventSchema.localDate,
        state: preventiveIntakeEventSchema.state,
      })
      .from(preventiveIntakeEventSchema)
      .where(
        and(
          eq(preventiveIntakeEventSchema.userId, args.userId),
          eq(preventiveIntakeEventSchema.planId, args.planId),
          gte(preventiveIntakeEventSchema.localDate, ymdToDbDate(last28From as LocalDateString)),
          lte(preventiveIntakeEventSchema.localDate, ymdToDbDate(todayLocalDate)),
        ),
      );

    const intakeEvents = intakeRows.map(r => ({
      localDate: dbDateToYmd(r.localDate),
      state: r.state as any,
    }));

    const adherence7 = resolveAdherenceForRange({
      plan: planLite,
      from: last7From,
      to: todayLocalDate,
      timezone,
      events: intakeEvents,
    });
    const adherence28 = resolveAdherenceForRange({
      plan: planLite,
      from: last28From,
      to: todayLocalDate,
      timezone,
      events: intakeEvents,
    });

    const timelineWeeks = (() => {
      const weeks: Array<{ weekStart: LocalDateString; migraineDays: number; adherence: number | null }> = [];
      const start = DateTime.fromISO(startDate, { zone: timezone }).startOf('week');
      const end = DateTime.fromISO(todayLocalDate, { zone: timezone }).startOf('week');
      let cur = start;
      while (cur <= end) {
        const weekStart = cur.toISODate()! as LocalDateString;
        const weekEnd = cur.plus({ days: 6 }).toISODate()! as LocalDateString;
        const diaryWeek = diaryDays.filter(d => d.localDate >= weekStart && d.localDate <= weekEnd);
        const migraineDays = diaryWeek.reduce((n, d) => n + (d.dayType === 'migraine_day' ? 1 : 0), 0);
        const adherence = resolveAdherenceForRange({
          plan: planLite,
          from: weekStart,
          to: weekEnd,
          timezone,
          events: intakeEvents,
        });
        const adherencePct = adherence.taken + adherence.missed > 0
          ? adherence.taken / (adherence.taken + adherence.missed)
          : null;
        weeks.push({ weekStart, migraineDays, adherence: adherencePct });
        cur = cur.plus({ weeks: 1 });
      }
      return weeks.slice(-12);
    })();

    const planLabel = scheduleLabel(planLite);

    return {
      timezone,
      plan: {
        id: plan.id,
        name: plan.name,
        kind: plan.kind as string,
        doseText: plan.doseText ?? null,
        scheduleLabel: planLabel,
        scheduleType: plan.scheduleType as string,
        schedulePayload: plan.schedulePayload as PreventiveSchedulePayload,
        startDate,
        status: plan.status as PreventivePlanStatusType,
        reminderTimes: plan.reminderTimes ?? [],
        remindersEnabled: plan.remindersEnabled,
      },
      baseline: {
        from: baselineFrom,
        to: baselineTo,
        mmd: baseline.totals.mmdMin,
        mhd: baseline.totals.mhdMin,
        acuteMedicationDays: baseline.totals.acuteMedicationDays,
        coverage: baseline.totals.coverage,
      },
      evaluation: evaluation
        ? {
            from: evalFrom,
            to: evalEnd,
            mmd: evaluation.totals.mmdMin,
            mhd: evaluation.totals.mhdMin,
            acuteMedicationDays: evaluation.totals.acuteMedicationDays,
            coverage: evaluation.totals.coverage,
            percentChangeMmd: percentChange,
            responder50: responder.status,
            missingDaysNeeded: responder.missingDays,
          }
        : null,
      evaluationLong: evaluationLong
        ? {
            from: evalFrom,
            to: evalLongEnd,
            mmd: evaluationLong.totals.mmdMin,
            mhd: evaluationLong.totals.mhdMin,
            acuteMedicationDays: evaluationLong.totals.acuteMedicationDays,
            coverage: evaluationLong.totals.coverage,
          }
        : null,
      adherence: {
        last7: adherence7,
        last28: adherence28,
      },
      timelineWeeks,
    };
  }

  async getPlanDetail(userId: string, planId: string): Promise<{
    id: string;
    name: string;
    kind: string;
    doseText: string | null;
    scheduleType: string;
    schedulePayload: PreventiveSchedulePayload;
    startDate: LocalDateString;
    status: PreventivePlanStatusType;
  } | null> {
    const [row] = await db
      .select({
        id: preventivePlanSchema.id,
        name: preventivePlanSchema.name,
        kind: preventivePlanSchema.kind,
        doseText: preventivePlanSchema.doseText,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, userId), eq(preventivePlanSchema.id, planId)))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      kind: row.kind as string,
      doseText: row.doseText ?? null,
      scheduleType: row.scheduleType as string,
      schedulePayload: row.schedulePayload as PreventiveSchedulePayload,
      startDate: dbDateToYmd(row.startDate),
      status: row.status as PreventivePlanStatusType,
    };
  }

  async resolveMedicationName(args: { userId: string; catalogMedicationId?: string | null }): Promise<string | null> {
    if (!args.catalogMedicationId) {
      return null;
    }
    const [row] = await db
      .select({ canonicalName: medicationsCatalogSchema.canonicalName })
      .from(medicationsCatalogSchema)
      .where(eq(medicationsCatalogSchema.id, args.catalogMedicationId))
      .limit(1);
    return row?.canonicalName ?? null;
  }

  async getRecentInsight(args: { userId: string }): Promise<{
    adherencePct: number | null;
    migraineDays: number;
    from: LocalDateString;
    to: LocalDateString;
  } | null> {
    const timezone = resolveTimezone(await getUserTimezone(args.userId));
    const to: LocalDateString = DateTime.now().setZone(timezone).toISODate()! as LocalDateString;
    const from: LocalDateString = DateTime.fromISO(to).minus({ days: 6 }).toISODate()! as LocalDateString;

    const plans = await db
      .select({
        id: preventivePlanSchema.id,
        kind: preventivePlanSchema.kind,
        scheduleType: preventivePlanSchema.scheduleType,
        schedulePayload: preventivePlanSchema.schedulePayload,
        startDate: preventivePlanSchema.startDate,
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(and(eq(preventivePlanSchema.userId, args.userId), eq(preventivePlanSchema.status, 'active')));

    if (plans.length === 0) {
      return null;
    }

    const planIds = plans.map(p => p.id);
    const events = await db
      .select({
        planId: preventiveIntakeEventSchema.planId,
        localDate: preventiveIntakeEventSchema.localDate,
        state: preventiveIntakeEventSchema.state,
      })
      .from(preventiveIntakeEventSchema)
      .where(
        and(
          eq(preventiveIntakeEventSchema.userId, args.userId),
          inArray(preventiveIntakeEventSchema.planId, planIds),
          gte(preventiveIntakeEventSchema.localDate, ymdToDbDate(from)),
          lte(preventiveIntakeEventSchema.localDate, ymdToDbDate(to)),
        ),
      );

    if (events.length === 0) {
      return null;
    }

    const eventsByPlan = new Map<string, Array<{ localDate: LocalDateString; state: any }>>();
    for (const e of events) {
      const list = eventsByPlan.get(e.planId) ?? [];
      list.push({ localDate: dbDateToYmd(e.localDate), state: e.state as any });
      eventsByPlan.set(e.planId, list);
    }

    let totalTaken = 0;
    let totalMissed = 0;
    for (const plan of plans) {
      const startDate = dbDateToYmd(plan.startDate);
      const summary = resolveAdherenceForRange({
        plan: {
          id: plan.id,
          kind: plan.kind as any,
          scheduleType: plan.scheduleType as any,
          schedulePayload: plan.schedulePayload as PreventiveSchedulePayload,
          startDate,
          status: plan.status as any,
        },
        from,
        to,
        timezone,
        events: eventsByPlan.get(plan.id) ?? [],
      });
      totalTaken += summary.taken;
      totalMissed += summary.missed;
    }

    const adherencePct = totalTaken + totalMissed > 0 ? totalTaken / (totalTaken + totalMissed) : null;

    const diaryRows = await db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(from)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(to)),
        ),
      );

    const migraineDays = diaryRows.reduce((n, d) => n + (d.dayType === 'migraine_day' ? 1 : 0), 0);

    return { adherencePct, migraineDays, from, to };
  }
}

export const preventivePlansService = new PreventivePlansService();
