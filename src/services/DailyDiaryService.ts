import type { LocalDateString } from '@/services/localDate';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  acuteDosesSchema,
  dailyDiaryEntrySchema,
  episodeSchema,
  medicationIntakesSchema,
  medicationsCatalogSchema,
  preventiveIntakeEventSchema,
  preventivePlanSchema,
  userMedicationsSchema,
} from '@/models/Schema';
import { deriveTouchedLocalDatesForEpisode } from '@/services/diary/attackDayDerivation';
import { recomputeDayRowsForDates } from '@/services/diary/recomputeDayRows';
import { dbDateToYmd, isEditableLocalDate, ymdToDbDate } from '@/services/localDate';
import { getLocalDatesOverlappedByRange, toLocalISODate } from '@/services/outcomes/localDateOverlap';
import { recordSleepAdherenceForDay } from '@/services/programs/recordSleepAdherence';
import { getUserTimezone } from '@/services/userTimezone';

export type DiaryDayType = 'headache_free' | 'headache_day' | 'migraine_day';
export type DiaryDayCreatedFrom = 'user' | 'attack';

export type DailyDiaryEntryDTO = {
  id: string;
  userId: string;
  localDate: LocalDateString;
  timezone: string;
  dayType: DiaryDayType;
  createdFrom: DiaryDayCreatedFrom;
  impact: number | null;
  notes: string | null;
  bedTimeLocal: string | null;
  wakeTimeLocal: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DailyDiaryRangeResult = {
  timezone: string;
  entries: DailyDiaryEntryDTO[];
  // Optional indicators for month UI.
  attackDays: LocalDateString[];
  medicationDays: LocalDateString[];
  coverage: { totalDays: number; recordedDays: number; missingDays: number };
};

export type UpsertDailyDiaryPatch = Partial<{
  dayType: DiaryDayType;
  impact: number | null;
  notes: string | null;
  bedTimeLocal: string | null;
  wakeTimeLocal: string | null;
}>;

export type DailyDiaryErrorCode
  = | 'NOT_EDITABLE'
    | 'VALIDATION_ERROR'
    | 'MIGRAINE_DAY_REQUIRED'
    | 'HEADACHE_FREE_NOT_ALLOWED';

export class DailyDiaryError extends Error {
  code: DailyDiaryErrorCode;
  details?: unknown;
  constructor(code: DailyDiaryErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function listLocalDatesInclusive(args: {
  from: LocalDateString;
  to: LocalDateString;
  timezone: string;
}): LocalDateString[] {
  const start = DateTime.fromISO(args.from, { zone: args.timezone }).startOf('day');
  const end = DateTime.fromISO(args.to, { zone: args.timezone }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) {
    throw new DailyDiaryError('VALIDATION_ERROR', 'Invalid date range');
  }
  const out: LocalDateString[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur.toISODate()! as LocalDateString);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

function toDto(row: typeof dailyDiaryEntrySchema.$inferSelect): DailyDiaryEntryDTO {
  return {
    id: row.id,
    userId: row.userId,
    localDate: dbDateToYmd(row.localDate),
    timezone: row.timezone,
    dayType: row.dayType as any,
    createdFrom: (row.createdFrom as any) ?? 'user',
    impact: row.impact ?? null,
    notes: row.notes ?? null,
    bedTimeLocal: row.bedTimeLocal ?? null,
    wakeTimeLocal: row.wakeTimeLocal ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validatePatch(patch: UpsertDailyDiaryPatch): void {
  if (patch.dayType && patch.dayType !== 'headache_free' && patch.dayType !== 'headache_day' && patch.dayType !== 'migraine_day') {
    throw new DailyDiaryError('VALIDATION_ERROR', 'Invalid dayType');
  }
  if (patch.impact !== undefined && patch.impact !== null) {
    if (!Number.isInteger(patch.impact) || patch.impact < 0 || patch.impact > 4) {
      throw new DailyDiaryError('VALIDATION_ERROR', 'impact must be an integer in range 0..4');
    }
  }
  if (patch.notes !== undefined && patch.notes !== null && typeof patch.notes !== 'string') {
    throw new DailyDiaryError('VALIDATION_ERROR', 'notes must be string or null');
  }
  if (patch.notes && patch.notes.length > 2000) {
    throw new DailyDiaryError('VALIDATION_ERROR', 'notes too long');
  }
  for (const key of ['bedTimeLocal', 'wakeTimeLocal'] as const) {
    const value = patch[key];
    if (value !== undefined && value !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new DailyDiaryError('VALIDATION_ERROR', `${key} must be HH:MM`);
    }
  }
}

function getPatched<T>(args: { patch: Record<string, any>; key: string; existing: T }): T {
  return Object.hasOwn(args.patch, args.key) ? args.patch[args.key] : args.existing;
}

export class DailyDiaryService {
  private async getAttackEvidenceForLocalDate(args: {
    userId: string;
    localDate: LocalDateString;
    timezone: string;
    now?: Date;
  }): Promise<{ hasMigraine: boolean; hasHeadache: boolean }> {
    const now = args.now ?? new Date();
    const dayStartUtc = DateTime.fromISO(args.localDate, { zone: args.timezone }).startOf('day').toUTC().toJSDate();
    const dayEndExclusiveUtc = DateTime.fromISO(args.localDate, { zone: args.timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const episodes = await db
      .select({
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        isOngoing: episodeSchema.isOngoing,
        attackType: episodeSchema.attackType,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          lt(episodeSchema.startTime, dayEndExclusiveUtc),
          or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, dayStartUtc)),
        ),
      );

    let hasMigraine = false;
    let hasHeadache = false;
    for (const ep of episodes) {
      const end = ep.endTime ?? (ep.isOngoing ? now : null);
      for (const d of getLocalDatesOverlappedByRange({ start: ep.startTime, end, timezone: args.timezone })) {
        if (d !== args.localDate) {
          continue;
        }
        // Backward compatibility: if attackType is missing/null, treat as migraine.
        const attackType: 'migraine' | 'headache' = ep.attackType === 'headache' ? 'headache' : 'migraine';
        if (attackType === 'migraine') {
          hasMigraine = true;
        } else {
          hasHeadache = true;
        }
      }
    }
    return { hasMigraine, hasHeadache };
  }

  async getDailyDiaryRange(args: {
    userId: string;
    fromLocalDate: LocalDateString;
    toLocalDate: LocalDateString;
  }): Promise<DailyDiaryRangeResult> {
    const timezone = await getUserTimezone(args.userId);

    const days = listLocalDatesInclusive({
      from: args.fromLocalDate,
      to: args.toLocalDate,
      timezone,
    });

    // Indicators for month view
    const rangeStartUtc = DateTime.fromISO(args.fromLocalDate, { zone: timezone }).startOf('day').toUTC().toJSDate();
    const rangeEndExclusiveUtc = DateTime.fromISO(args.toLocalDate, { zone: timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const episodes = await db
      .select({
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        isOngoing: episodeSchema.isOngoing,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          lt(episodeSchema.startTime, rangeEndExclusiveUtc),
          or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, rangeStartUtc)),
        ),
      );

    const attackDays = new Set<LocalDateString>();
    for (const ep of episodes) {
      const end = ep.endTime ?? (ep.isOngoing ? new Date() : null);
      for (const d of getLocalDatesOverlappedByRange({ start: ep.startTime, end, timezone })) {
        if ((d as any) >= args.fromLocalDate && (d as any) <= args.toLocalDate) {
          attackDays.add(d as LocalDateString);
        }
      }
    }

    // Enforce deterministic "attacks update day classification" rule on reads:
    // This removes the old "conflict" mode by ensuring the day backbone is consistent.
    if (attackDays.size > 0) {
      await recomputeDayRowsForDates({
        userId: args.userId,
        localDates: [...attackDays],
        timezone,
      });
    }

    const rows = await db
      .select()
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(args.fromLocalDate)),
          lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(args.toLocalDate)),
        ),
      )
      .orderBy(dailyDiaryEntrySchema.localDate);

    const entries = rows.map(toDto);

    const intakes = await db
      .select({ takenAt: medicationIntakesSchema.takenAt })
      .from(medicationIntakesSchema)
      .where(
        and(
          eq(medicationIntakesSchema.userId, args.userId),
          gte(medicationIntakesSchema.takenAt, rangeStartUtc),
          lt(medicationIntakesSchema.takenAt, rangeEndExclusiveUtc),
        ),
      );

    const acuteDoses = await db
      .select({ takenAt: acuteDosesSchema.takenAt })
      .from(acuteDosesSchema)
      .where(
        and(
          eq(acuteDosesSchema.userId, args.userId),
          gte(acuteDosesSchema.takenAt, rangeStartUtc),
          lt(acuteDosesSchema.takenAt, rangeEndExclusiveUtc),
        ),
      );

    const medicationDays = new Set<LocalDateString>();
    for (const m of intakes) {
      medicationDays.add(toLocalISODate({ instant: m.takenAt, timezone }) as LocalDateString);
    }
    for (const d of acuteDoses) {
      medicationDays.add(toLocalISODate({ instant: d.takenAt, timezone }) as LocalDateString);
    }

    return {
      timezone,
      entries,
      attackDays: [...attackDays].sort(),
      medicationDays: [...medicationDays].sort(),
      coverage: {
        totalDays: days.length,
        recordedDays: entries.length,
        missingDays: days.length - entries.length,
      },
    };
  }

  async getTodayDiaryState(userId: string): Promise<{
    timezone: string;
    todayLocalDate: LocalDateString;
    entry: DailyDiaryEntryDTO | null;
  }> {
    const timezone = await getUserTimezone(userId);
    const todayLocalDate = DateTime.now().setZone(timezone).toISODate()! as LocalDateString;

    // Ensure deterministic day state (attacks update the day automatically)
    await recomputeDayRowsForDates({ userId, localDates: [todayLocalDate], timezone });

    const [row] = await db
      .select()
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, userId),
          eq(dailyDiaryEntrySchema.localDate, ymdToDbDate(todayLocalDate)),
        ),
      )
      .limit(1);

    return { timezone, todayLocalDate, entry: row ? toDto(row) : null };
  }

  async upsertDailyDiaryEntry(args: {
    userId: string;
    localDate: LocalDateString;
    patch: UpsertDailyDiaryPatch;
    now?: Date;
  }): Promise<DailyDiaryEntryDTO> {
    const timezone = await getUserTimezone(args.userId);
    const now = args.now ?? new Date();

    if (!isEditableLocalDate(args.localDate, now, timezone)) {
      throw new DailyDiaryError(
        'NOT_EDITABLE',
        'This day is outside the editing window (last 30 days).',
        { localDate: args.localDate },
      );
    }

    validatePatch(args.patch);

    const [existing] = await db
      .select()
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          eq(dailyDiaryEntrySchema.localDate, ymdToDbDate(args.localDate)),
        ),
      )
      .limit(1);

    if (!existing && !args.patch.dayType) {
      throw new DailyDiaryError('VALIDATION_ERROR', 'dayType is required to create a diary entry');
    }

    const requestedDayType = (args.patch.dayType ?? existing?.dayType ?? null) as (DiaryDayType | null);
    if (!requestedDayType) {
      throw new DailyDiaryError('VALIDATION_ERROR', 'dayType is required');
    }

    const evidence = await this.getAttackEvidenceForLocalDate({
      userId: args.userId,
      localDate: args.localDate,
      timezone,
      now,
    });
    const evidenceDayType: DiaryDayType | null = evidence.hasMigraine
      ? 'migraine_day'
      : evidence.hasHeadache
        ? 'headache_day'
        : null;

    // If a migraine attack touches this day, the day must be migraine_day.
    // Reject explicit downgrades so the UI can show a clear notification (same pattern as headache_free).
    if (
      evidenceDayType === 'migraine_day'
      && Object.hasOwn(args.patch, 'dayType')
      && requestedDayType !== 'migraine_day'
    ) {
      throw new DailyDiaryError(
        'MIGRAINE_DAY_REQUIRED',
        'Not available because a migraine attack exists for this day.',
        { localDate: args.localDate },
      );
    }

    if (requestedDayType === 'headache_free' && evidenceDayType) {
      throw new DailyDiaryError(
        'HEADACHE_FREE_NOT_ALLOWED',
        'Not available because an attack exists for this day.',
        { localDate: args.localDate },
      );
    }

    // If the user upgrades the day to migraine_day while only headache attacks exist,
    // convert those touching headache attacks to migraine to keep "maximum level" consistent.
    if (requestedDayType === 'migraine_day' && evidenceDayType === 'headache_day' && evidence.hasHeadache && !evidence.hasMigraine) {
      const dayStartUtc = DateTime.fromISO(args.localDate, { zone: timezone }).startOf('day').toUTC().toJSDate();
      const dayEndExclusiveUtc = DateTime.fromISO(args.localDate, { zone: timezone })
        .plus({ days: 1 })
        .startOf('day')
        .toUTC()
        .toJSDate();

      const headacheEpisodes = await db
        .select({
          id: episodeSchema.id,
          startTime: episodeSchema.startTime,
          endTime: episodeSchema.endTime,
          isOngoing: episodeSchema.isOngoing,
        })
        .from(episodeSchema)
        .where(
          and(
            eq(episodeSchema.userId, args.userId),
            eq(episodeSchema.attackType, 'headache'),
            lt(episodeSchema.startTime, dayEndExclusiveUtc),
            or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, dayStartUtc)),
          ),
        );

      if (headacheEpisodes.length > 0) {
        await db
          .update(episodeSchema)
          .set({ attackType: 'migraine' })
          .where(
            and(
              eq(episodeSchema.userId, args.userId),
              inArray(episodeSchema.id, headacheEpisodes.map(e => e.id)),
            ),
          );

        const touchedDates = new Set<string>([args.localDate]);
        for (const ep of headacheEpisodes) {
          for (const d of deriveTouchedLocalDatesForEpisode({
            startTime: ep.startTime,
            endTime: ep.endTime,
            isOngoing: ep.isOngoing,
            timezone,
            now,
          })) {
            touchedDates.add(d);
          }
        }
        await recomputeDayRowsForDates({ userId: args.userId, localDates: [...touchedDates], timezone });
      }
    }

    const nextDayType: DiaryDayType = (() => {
      if (!evidenceDayType) {
        return requestedDayType;
      }
      if (evidenceDayType === 'migraine_day') {
        return 'migraine_day';
      }
      // evidence=headache_day
      return requestedDayType === 'migraine_day' ? 'migraine_day' : 'headache_day';
    })();

    const nextNotes = getPatched({ patch: args.patch, key: 'notes', existing: existing?.notes ?? null });
    const nextBedTimeLocal = getPatched({
      patch: args.patch,
      key: 'bedTimeLocal',
      existing: existing?.bedTimeLocal ?? null,
    }) as string | null;
    const nextWakeTimeLocal = getPatched({
      patch: args.patch,
      key: 'wakeTimeLocal',
      existing: existing?.wakeTimeLocal ?? null,
    }) as string | null;

    const values = {
      userId: args.userId,
      localDate: ymdToDbDate(args.localDate),
      timezone,
      dayType: nextDayType,
      createdFrom: 'user',
      impact: getPatched({ patch: args.patch, key: 'impact', existing: existing?.impact ?? null }),
      notes: nextNotes,
      bedTimeLocal: nextBedTimeLocal,
      wakeTimeLocal: nextWakeTimeLocal,
      updatedAt: new Date(),
    };

    const [saved] = await db
      .insert(dailyDiaryEntrySchema)
      .values(values as any)
      .onConflictDoUpdate({
        target: [dailyDiaryEntrySchema.userId, dailyDiaryEntrySchema.localDate],
        set: values as any,
      })
      .returning();

    if (!saved) {
      throw new DailyDiaryError('VALIDATION_ERROR', 'Failed to save diary entry');
    }

    if (
      Object.hasOwn(args.patch, 'bedTimeLocal')
      || Object.hasOwn(args.patch, 'wakeTimeLocal')
    ) {
      await recordSleepAdherenceForDay({
        userId: args.userId,
        localDate: args.localDate,
        bedTimeLocal: nextBedTimeLocal,
        wakeTimeLocal: nextWakeTimeLocal,
      });
    }

    return toDto(saved);
  }

  /**
   * Attack overlap set for a local-date window (inclusive).
   * Used only for optional UI indicators.
   */
  async getAttackOverlapDays(args: {
    userId: string;
    fromLocalDate: LocalDateString;
    toLocalDate: LocalDateString;
    now?: Date;
  }): Promise<Set<LocalDateString>> {
    const timezone = await getUserTimezone(args.userId);
    const now = args.now ?? new Date();

    const rangeStartUtc = DateTime.fromISO(args.fromLocalDate, { zone: timezone })
      .startOf('day')
      .toUTC()
      .toJSDate();
    const rangeEndExclusiveUtc = DateTime.fromISO(args.toLocalDate, { zone: timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const episodes = await db
      .select({
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        isOngoing: episodeSchema.isOngoing,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          lt(episodeSchema.startTime, rangeEndExclusiveUtc),
          or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, rangeStartUtc)),
        ),
      );

    const days = listLocalDatesInclusive({
      from: args.fromLocalDate,
      to: args.toLocalDate,
      timezone,
    });
    const allowed = new Set(days);

    const out = new Set<LocalDateString>();
    for (const ep of episodes) {
      const end = ep.endTime ?? (ep.isOngoing ? now : null);
      for (const d of getLocalDatesOverlappedByRange({ start: ep.startTime, end, timezone })) {
        if (allowed.has(d as any)) {
          out.add(d as LocalDateString);
        }
      }
    }
    return out;
  }

  async getDayDetail(args: {
    userId: string;
    localDate: LocalDateString;
  }): Promise<{
    timezone: string;
    entry: DailyDiaryEntryDTO | null;
    attacks: Array<{
      id: number;
      attackType: 'migraine' | 'headache';
      startTime: string;
      endTime: string | null;
      isOngoing: boolean;
      intensity: number;
      triggers: string[];
      protectors: string[];
    }>;
    medicationIntakes: Array<{
      id: string;
      takenAt: string;
      label: string;
      dose: string | null;
      unit: string | null;
      unitIsCustom: boolean;
    }>;
    preventiveIntakes: Array<{
      id: string;
      planId: string;
      label: string;
      doseText: string | null;
      state: string;
      takenAt: string | null;
    }>;
  }> {
    const timezone = await getUserTimezone(args.userId);
    await recomputeDayRowsForDates({ userId: args.userId, localDates: [args.localDate], timezone });
    const dayStartUtc = DateTime.fromISO(args.localDate, { zone: timezone }).startOf('day').toUTC().toJSDate();
    const dayEndExclusiveUtc = DateTime.fromISO(args.localDate, { zone: timezone })
      .plus({ days: 1 })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const [row] = await db
      .select()
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, args.userId),
          eq(dailyDiaryEntrySchema.localDate, ymdToDbDate(args.localDate)),
        ),
      )
      .limit(1);

    const attacks = await db
      .select({
        id: episodeSchema.id,
        attackType: episodeSchema.attackType,
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        isOngoing: episodeSchema.isOngoing,
        intensity: episodeSchema.intensity,
        triggers: episodeSchema.triggers,
        protectors: episodeSchema.protectors,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, args.userId),
          lt(episodeSchema.startTime, dayEndExclusiveUtc),
          or(isNull(episodeSchema.endTime), gte(episodeSchema.endTime, dayStartUtc)),
        ),
      )
      .orderBy(desc(episodeSchema.isOngoing), episodeSchema.startTime);

    const medicationIntakes = await db
      .select({
        id: medicationIntakesSchema.id,
        takenAt: medicationIntakesSchema.takenAt,
        dose: medicationIntakesSchema.dose,
        unit: medicationIntakesSchema.unit,
        unitIsCustom: medicationIntakesSchema.unitIsCustom,
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
          gte(medicationIntakesSchema.takenAt, dayStartUtc),
          lt(medicationIntakesSchema.takenAt, dayEndExclusiveUtc),
        ),
      )
      .orderBy(medicationIntakesSchema.takenAt);

    const acuteMedicationDoses = await db
      .select({
        id: acuteDosesSchema.id,
        takenAt: acuteDosesSchema.takenAt,
        dose: acuteDosesSchema.dose,
        unit: acuteDosesSchema.unit,
        unitIsCustom: acuteDosesSchema.unitIsCustom,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(acuteDosesSchema)
      .innerJoin(userMedicationsSchema, eq(acuteDosesSchema.medicationId, userMedicationsSchema.id))
      .leftJoin(medicationsCatalogSchema, eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id))
      .where(
        and(
          eq(acuteDosesSchema.userId, args.userId),
          gte(acuteDosesSchema.takenAt, dayStartUtc),
          lt(acuteDosesSchema.takenAt, dayEndExclusiveUtc),
        ),
      )
      .orderBy(acuteDosesSchema.takenAt);

    // Preventive doses live in their own day-keyed table rather than
    // medication_intakes, so the diary has to read them separately or a dose
    // logged from the "Preventives due" card never shows up on the day.
    const preventiveIntakes = await db
      .select({
        id: preventiveIntakeEventSchema.id,
        planId: preventiveIntakeEventSchema.planId,
        state: preventiveIntakeEventSchema.state,
        takenAt: preventiveIntakeEventSchema.takenAt,
        name: preventivePlanSchema.name,
        doseText: preventivePlanSchema.doseText,
      })
      .from(preventiveIntakeEventSchema)
      .innerJoin(preventivePlanSchema, eq(preventiveIntakeEventSchema.planId, preventivePlanSchema.id))
      .where(
        and(
          eq(preventiveIntakeEventSchema.userId, args.userId),
          eq(preventiveIntakeEventSchema.localDate, ymdToDbDate(args.localDate)),
        ),
      );

    const labelFor = (r: { medicationName: string | null; customName: string | null; canonicalName: string | null }) =>
      (r.medicationName ?? r.customName ?? r.canonicalName ?? 'Medication').trim() || 'Medication';

    const mergedMedicationRows = medicationIntakes.map(m => ({
      id: `intake:${m.id}`,
      takenAt: m.takenAt.toISOString(),
      label: labelFor({ medicationName: m.medicationName ?? null, customName: m.customName ?? null, canonicalName: m.canonicalName ?? null }),
      dose: m.dose ?? null,
      unit: m.unit ?? null,
      unitIsCustom: m.unitIsCustom ?? false,
    })).concat(acuteMedicationDoses.map(m => ({
      id: `acute:${m.id}`,
      takenAt: m.takenAt.toISOString(),
      label: labelFor({ medicationName: null, customName: m.customName ?? null, canonicalName: m.canonicalName ?? null }),
      dose: m.dose ?? null,
      unit: m.unit ?? null,
      unitIsCustom: m.unitIsCustom ?? false,
    })));

    const dedupe = new Map<string, (typeof mergedMedicationRows)[number]>();
    for (const row of mergedMedicationRows) {
      const minuteBucket = row.takenAt.slice(0, 16);
      const key = `${minuteBucket}|${row.label.toLowerCase()}|${row.dose ?? ''}|${row.unit ?? ''}`;
      if (!dedupe.has(key)) {
        dedupe.set(key, row);
      }
    }

    return {
      timezone,
      entry: row ? toDto(row) : null,
      attacks: attacks.map(a => ({
        id: a.id,
        attackType: a.attackType as any,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime ? a.endTime.toISOString() : null,
        isOngoing: a.isOngoing,
        intensity: a.intensity,
        triggers: a.triggers ?? [],
        protectors: a.protectors ?? [],
      })),
      medicationIntakes: [...dedupe.values()]
        .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
      preventiveIntakes: preventiveIntakes.map(p => ({
        id: p.id,
        planId: p.planId,
        label: p.name,
        doseText: p.doseText ?? null,
        state: p.state as string,
        takenAt: p.takenAt ? p.takenAt.toISOString() : null,
      })),
    };
  }
}

export const dailyDiaryService = new DailyDiaryService();
