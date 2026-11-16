import type { AppointmentPrepSnapshot } from '@/models/appointmentPrep';
import type { LocalDateString } from '@/services/localDate';

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  appointmentPrepSchema,
  dailyDiaryEntrySchema,
  episodeSchema,
  medicationIntakesSchema,
  medicationsCatalogSchema,
  preventivePlanSchema,
  PreventivePlanStatus,
  questionnaireResponseSchema,
  QuestionnaireType,
  userMedicationsSchema,
} from '@/models/Schema';
import { buildAppointmentPrepSnapshot } from '@/services/appointmentPrep/summary';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { computeOutcomesForRange } from '@/services/outcomes/computeOutcomes';
import { getUserTimezone } from '@/services/userTimezone';

export type AppointmentPrepDraftListItem = {
  id: string;
  appointmentDate: LocalDateString;
  visitLabel: string | null;
  clinicianName: string | null;
  visitReason: string | null;
  topConcerns: string[];
  doctorQuestions: string[];
  personalNotes: string | null;
  compareWindowDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentPrepDraft = AppointmentPrepDraftListItem & {
  generatedSnapshot: AppointmentPrepSnapshot;
};

export type CreateAppointmentPrepDraftInput = {
  appointmentDate: LocalDateString;
  visitLabel?: string | null;
  clinicianName?: string | null;
  visitReason?: string | null;
  topConcerns?: string[];
  doctorQuestions?: string[];
  personalNotes?: string | null;
  compareWindowDays?: number;
};

export type UpdateAppointmentPrepDraftInput = Partial<Omit<CreateAppointmentPrepDraftInput, 'compareWindowDays'>>;

function normalizeText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapDraftRow(row: {
  id: string;
  appointmentDate: Date;
  visitLabel: string | null;
  clinicianName: string | null;
  visitReason: string | null;
  topConcerns: string[];
  doctorQuestions: string[];
  personalNotes: string | null;
  compareWindowDays: number;
  generatedSnapshot?: AppointmentPrepSnapshot;
  createdAt: Date;
  updatedAt: Date;
}): AppointmentPrepDraft {
  return {
    id: row.id,
    appointmentDate: dbDateToYmd(row.appointmentDate),
    visitLabel: row.visitLabel ?? null,
    clinicianName: row.clinicianName ?? null,
    visitReason: row.visitReason ?? null,
    topConcerns: row.topConcerns ?? [],
    doctorQuestions: row.doctorQuestions ?? [],
    personalNotes: row.personalNotes ?? null,
    compareWindowDays: row.compareWindowDays,
    generatedSnapshot: row.generatedSnapshot ?? {
      compareWindowDays: row.compareWindowDays,
      coverage: { totalDays: 0, recordedDays: 0, missingDays: 0 },
      attackStats: { totalAttacks: 0, avgIntensity: null },
      currentSnapshot: {
        headacheBurden: { migraineDays: 0, headacheDays: 0 },
        acuteMedicationDays: 0,
        preventiveNames: [],
        questionnaireScores: { hit6: null, midas: null },
      },
      whatChangedKeys: [],
      questionPromptKeys: [],
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveWindowDates(args: {
  timezone: string;
  compareWindowDays: number;
}): { fromLocal: string; toLocal: string; fromUtc: Date; toUtcExclusive: Date } {
  const toLocal = DateTime.now().setZone(args.timezone).startOf('day').toISODate()!;
  const fromLocal = DateTime.fromISO(toLocal, { zone: args.timezone })
    .minus({ days: args.compareWindowDays - 1 })
    .toISODate()!;

  return {
    fromLocal,
    toLocal,
    fromUtc: DateTime.fromISO(fromLocal, { zone: args.timezone }).startOf('day').toUTC().toJSDate(),
    toUtcExclusive: DateTime.fromISO(toLocal, { zone: args.timezone }).plus({ days: 1 }).startOf('day').toUTC().toJSDate(),
  };
}

export class AppointmentPrepService {
  async listDrafts(userId: string): Promise<AppointmentPrepDraftListItem[]> {
    const rows = await db
      .select({
        id: appointmentPrepSchema.id,
        appointmentDate: appointmentPrepSchema.appointmentDate,
        visitLabel: appointmentPrepSchema.visitLabel,
        clinicianName: appointmentPrepSchema.clinicianName,
        visitReason: appointmentPrepSchema.visitReason,
        topConcerns: appointmentPrepSchema.topConcerns,
        doctorQuestions: appointmentPrepSchema.doctorQuestions,
        personalNotes: appointmentPrepSchema.personalNotes,
        compareWindowDays: appointmentPrepSchema.compareWindowDays,
        createdAt: appointmentPrepSchema.createdAt,
        updatedAt: appointmentPrepSchema.updatedAt,
      })
      .from(appointmentPrepSchema)
      .where(eq(appointmentPrepSchema.userId, userId))
      .orderBy(desc(appointmentPrepSchema.createdAt))
      .limit(100);

    return rows.map(row => ({
      id: row.id,
      appointmentDate: dbDateToYmd(row.appointmentDate),
      visitLabel: row.visitLabel ?? null,
      clinicianName: row.clinicianName ?? null,
      visitReason: row.visitReason ?? null,
      topConcerns: row.topConcerns ?? [],
      doctorQuestions: row.doctorQuestions ?? [],
      personalNotes: row.personalNotes ?? null,
      compareWindowDays: row.compareWindowDays,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getDraft(userId: string, draftId: string): Promise<AppointmentPrepDraft | null> {
    const [row] = await db
      .select({
        id: appointmentPrepSchema.id,
        appointmentDate: appointmentPrepSchema.appointmentDate,
        visitLabel: appointmentPrepSchema.visitLabel,
        clinicianName: appointmentPrepSchema.clinicianName,
        visitReason: appointmentPrepSchema.visitReason,
        topConcerns: appointmentPrepSchema.topConcerns,
        doctorQuestions: appointmentPrepSchema.doctorQuestions,
        personalNotes: appointmentPrepSchema.personalNotes,
        compareWindowDays: appointmentPrepSchema.compareWindowDays,
        generatedSnapshot: appointmentPrepSchema.generatedSnapshot,
        createdAt: appointmentPrepSchema.createdAt,
        updatedAt: appointmentPrepSchema.updatedAt,
      })
      .from(appointmentPrepSchema)
      .where(and(eq(appointmentPrepSchema.userId, userId), eq(appointmentPrepSchema.id, draftId)))
      .limit(1);

    return row ? mapDraftRow(row) : null;
  }

  async createDraft(userId: string, input: CreateAppointmentPrepDraftInput): Promise<{ id: string }> {
    const compareWindowDays = input.compareWindowDays ?? 90;
    const timezone = await getUserTimezone(userId);
    const window = resolveWindowDates({
      timezone,
      compareWindowDays,
    });

    const [diaryRows, intakeRows, questionnaireRows, preventiveRows, episodeRows] = await Promise.all([
      db
        .select({
          localDate: dailyDiaryEntrySchema.localDate,
          dayType: dailyDiaryEntrySchema.dayType,
        })
        .from(dailyDiaryEntrySchema)
        .where(
          and(
            eq(dailyDiaryEntrySchema.userId, userId),
            gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(window.fromLocal as LocalDateString)),
            lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(window.toLocal as LocalDateString)),
          ),
        )
        .limit(200),
      db
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
            eq(medicationIntakesSchema.userId, userId),
            gte(medicationIntakesSchema.takenAt, window.fromUtc),
            lt(medicationIntakesSchema.takenAt, window.toUtcExclusive),
          ),
        )
        .limit(200),
      db
        .select({
          type: questionnaireResponseSchema.type,
          scoreTotal: questionnaireResponseSchema.scoreTotal,
          takenAt: questionnaireResponseSchema.takenAt,
        })
        .from(questionnaireResponseSchema)
        .where(
          and(
            eq(questionnaireResponseSchema.userId, userId),
            inArray(questionnaireResponseSchema.type, [QuestionnaireType.HIT6, QuestionnaireType.MIDAS]),
          ),
        )
        .orderBy(desc(questionnaireResponseSchema.takenAt))
        .limit(200),
      db
        .select({
          name: preventivePlanSchema.name,
        })
        .from(preventivePlanSchema)
        .where(
          and(
            eq(preventivePlanSchema.userId, userId),
            inArray(preventivePlanSchema.status, [PreventivePlanStatus.ACTIVE, PreventivePlanStatus.PAUSED]),
          ),
        )
        .orderBy(desc(preventivePlanSchema.createdAt))
        .limit(100),
      db
        .select({
          intensity: episodeSchema.intensity,
        })
        .from(episodeSchema)
        .where(
          and(
            eq(episodeSchema.userId, userId),
            gte(episodeSchema.startTime, window.fromUtc),
            lt(episodeSchema.startTime, window.toUtcExclusive),
          ),
        )
        .limit(200),
    ]);

    const outcomes = computeOutcomesForRange({
      timezone,
      windowDays: compareWindowDays,
      from: window.fromLocal,
      to: window.toLocal,
      diaryDays: diaryRows.map(row => ({
        localDate: dbDateToYmd(row.localDate),
        dayType: row.dayType as 'headache_free' | 'headache_day' | 'migraine_day',
      })),
      medicationIntakes: intakeRows.map((row) => {
        const name = (row.medicationName ?? row.customName ?? row.canonicalName ?? '').trim();
        return {
          takenAt: row.takenAt,
          name: name || undefined,
        };
      }),
    });

    const questionnaireScores = {
      hit6: questionnaireRows.find(row => row.type === QuestionnaireType.HIT6)?.scoreTotal ?? null,
      midas: questionnaireRows.find(row => row.type === QuestionnaireType.MIDAS)?.scoreTotal ?? null,
    };

    const preventiveNames = preventiveRows.map(row => normalizeText(row.name) ?? '').filter(Boolean);
    const attackIntensities = episodeRows.map(row => row.intensity);
    const attackStats = {
      totalAttacks: attackIntensities.length,
      avgIntensity: attackIntensities.length
        ? Math.round(attackIntensities.reduce((sum, intensity) => sum + intensity, 0) / attackIntensities.length)
        : null,
    };

    const snapshot = buildAppointmentPrepSnapshot({
      compareWindowDays,
      outcomes,
      questionnaires: {
        hit6: { score: questionnaireScores.hit6 },
        midas: { score: questionnaireScores.midas },
      },
      preventives: preventiveNames,
      attackStats,
    });

    const [created] = await db
      .insert(appointmentPrepSchema)
      .values({
        userId,
        appointmentDate: ymdToDbDate(input.appointmentDate),
        visitLabel: normalizeText(input.visitLabel),
        clinicianName: normalizeText(input.clinicianName),
        visitReason: normalizeText(input.visitReason),
        topConcerns: input.topConcerns ?? [],
        doctorQuestions: input.doctorQuestions ?? [],
        personalNotes: normalizeText(input.personalNotes),
        compareWindowDays,
        generatedSnapshot: snapshot,
      })
      .returning({ id: appointmentPrepSchema.id });

    if (!created) {
      throw new Error('Failed to create appointment prep draft');
    }

    return { id: created.id };
  }

  async updateDraft(
    userId: string,
    draftId: string,
    patch: UpdateAppointmentPrepDraftInput,
  ): Promise<AppointmentPrepDraft> {
    const existing = await this.getDraft(userId, draftId);
    if (!existing) {
      throw new Error('Appointment prep draft not found');
    }

    const updates: Partial<typeof appointmentPrepSchema.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (Object.hasOwn(patch, 'appointmentDate') && patch.appointmentDate) {
      updates.appointmentDate = ymdToDbDate(patch.appointmentDate);
    }
    if (Object.hasOwn(patch, 'visitLabel')) {
      updates.visitLabel = normalizeText(patch.visitLabel);
    }
    if (Object.hasOwn(patch, 'clinicianName')) {
      updates.clinicianName = normalizeText(patch.clinicianName);
    }
    if (Object.hasOwn(patch, 'visitReason')) {
      updates.visitReason = normalizeText(patch.visitReason);
    }
    if (Object.hasOwn(patch, 'topConcerns')) {
      updates.topConcerns = patch.topConcerns ?? [];
    }
    if (Object.hasOwn(patch, 'doctorQuestions')) {
      updates.doctorQuestions = patch.doctorQuestions ?? [];
    }
    if (Object.hasOwn(patch, 'personalNotes')) {
      updates.personalNotes = normalizeText(patch.personalNotes);
    }

    await db
      .update(appointmentPrepSchema)
      .set(updates)
      .where(and(eq(appointmentPrepSchema.userId, userId), eq(appointmentPrepSchema.id, draftId)));

    const updated = await this.getDraft(userId, draftId);
    if (!updated) {
      throw new Error('Appointment prep draft not found');
    }
    return updated;
  }

  async deleteDraft(userId: string, draftId: string): Promise<void> {
    const existing = await this.getDraft(userId, draftId);
    if (!existing) {
      throw new Error('Appointment prep draft not found');
    }

    await db
      .delete(appointmentPrepSchema)
      .where(and(eq(appointmentPrepSchema.userId, userId), eq(appointmentPrepSchema.id, draftId)));
  }
}

export const appointmentPrepService = new AppointmentPrepService();
