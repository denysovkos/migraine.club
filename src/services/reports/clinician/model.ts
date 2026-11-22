import type { ClinicianReportConfig } from './config';
import type { AppointmentPrepSnapshot } from '@/models/appointmentPrep';

import type { LocalDateString } from '@/services/localDate';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  appointmentPrepSchema,
  cycleBleedingDaySchema,
  CycleHormoneProfile,
  cycleSettingsSchema,
  dailyDiaryEntrySchema,
  episodeSchema,
  medicationIntakesSchema,
  medicationsCatalogSchema,
  preventivePlanSchema,
  questionnaireResponseSchema,
  userMedicationsSchema,
  userSchema,
} from '@/models/Schema';
import { buildRelativeAttackHistogram, computeBleedingStartDates, isInPerimenstrualWindow } from '@/services/cycle/cycleDomain';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { outcomesService } from '@/services/OutcomesService';
import { calculateMohGuardrail } from '@/services/reports/clinician/mohGuardrail';
import { toClinicianOutcomesPack } from '@/services/reports/clinician/outcomesPack';
import { sanitizeReportText, sanitizeReportTextArray } from '@/services/reports/clinician/sanitize';

import { getUserTimezone } from '@/services/userTimezone';
import { resolveClinicianReportRange, resolveSections } from './config';

const ATTACKS_PAGE_SIZE = 24;

export type ClinicianReportModel = {
  title: string;
  generatedAtIso: string;
  timezone: string;
  config: ClinicianReportConfig;
  appointmentPrep: null | {
    appointmentDate: string;
    visitLabel: string | null;
    clinicianName: string | null;
    visitReason: string | null;
    topConcerns: string[];
    doctorQuestions: string[];
    personalNotes: string | null;
    generatedSnapshot: AppointmentPrepSnapshot;
  };
  range: {
    from: string;
    to: string;
    label: string;
  };
  sections: string[];
  identity: {
    name: string | null;
  };
  dataQuality: {
    totalDays: number;
    trackedDays: number;
    missingDays: number;
    trackedPct: number;
    qualityLine: string;
  };
  outcomes: {
    mmd: number;
    mhd: number;
    acuteMedicationDays: number;
  };
  moh: {
    status: 'low' | 'watch' | 'high';
    title: string;
    text: string;
  };
  questionnaires: {
    hit6: { score: number | null; takenAt: string | null };
    midas: { score: number | null; takenAt: string | null };
    msq: { score: number | null; takenAt: string | null };
  };
  medications: {
    currentPreventives: string[];
    topAcuteMeds: Array<{ name: string; usageDays: number }>;
  };
  trends: {
    weeklyAttackStarts: Array<{ weekStart: string; count: number }>;
  };
  attacks: {
    total: number;
    pageSize: number;
    pages: ClinicianAttackRow[][];
  };
  diary: {
    days: Array<{ date: string; dayType: string; impact: number | null }>;
  };
  cycleHormones: {
    timeline: Array<{ date: string; bleeding: boolean; migraine: boolean }>;
    attacksInWindow: number;
    totalAttacks: number;
    windowStart: number;
    windowEnd: number;
    hormoneProfile: string | null;
    histogram: Array<{ relativeDay: number; count: number }>;
  } | null;
  disclaimers: string[];
};

export type ClinicianAttackRow = {
  date: string;
  durationHours: number | null;
  maxSeverity: number;
  symptoms: string[];
  acuteMeds: string[];
  effectiveness: string | null;
  impact: number | null;
};

export async function getClinicianReportModel(
  userId: string,
  config: ClinicianReportConfig,
): Promise<ClinicianReportModel> {
  const timezone = await getUserTimezone(userId);
  const range = resolveClinicianReportRange({ config, timezone });
  const from = DateTime.fromISO(range.from, { zone: timezone }).startOf('day');
  const to = DateTime.fromISO(range.to, { zone: timezone }).startOf('day');
  const rangeStartUtc = from.toUTC().toJSDate();
  const rangeEndExclusiveUtc = to.plus({ days: 1 }).toUTC().toJSDate();
  const totalDays = Math.max(1, Math.round(to.diff(from, 'days').days) + 1);
  const cycleTimelineTo = to.startOf('day');
  const cycleTimelineFrom = cycleTimelineTo.minus({ days: 89 }).startOf('day');
  const cycleTimelineStartUtc = cycleTimelineFrom.toUTC().toJSDate();
  const cycleTimelineEndExclusiveUtc = cycleTimelineTo.plus({ days: 1 }).toUTC().toJSDate();
  // Date columns take the local calendar date. A JS Date of local midnight
  // serializes to the previous UTC day east of UTC, dropping the last day.
  const cycleTimelineFromDb = ymdToDbDate(cycleTimelineFrom.toISODate()! as LocalDateString);
  const cycleTimelineToDb = ymdToDbDate(cycleTimelineTo.toISODate()! as LocalDateString);

  const [episodes, diaryRows, medIntakes, preventives, questionnaires, userRows, outcomes, cycleSettingsRows, cycleBleedingRows, cycleMigraineRows, cycleAttackRows, appointmentPrepRows] = await Promise.all([
    db
      .select({
        id: episodeSchema.id,
        startTime: episodeSchema.startTime,
        endTime: episodeSchema.endTime,
        intensity: episodeSchema.intensity,
        symptoms: episodeSchema.symptoms,
        medications: episodeSchema.medications,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, userId),
          gte(episodeSchema.startTime, rangeStartUtc),
          lt(episodeSchema.startTime, rangeEndExclusiveUtc),
        ),
      )
      .orderBy(desc(episodeSchema.startTime)),
    db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
        dayType: dailyDiaryEntrySchema.dayType,
        impact: dailyDiaryEntrySchema.impact,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, userId),
          gte(dailyDiaryEntrySchema.localDate, new Date(`${range.from}T00:00:00.000Z`)),
          lte(dailyDiaryEntrySchema.localDate, new Date(`${range.to}T00:00:00.000Z`)),
        ),
      )
      .orderBy(desc(dailyDiaryEntrySchema.localDate)),
    db
      .select({
        episodeId: medicationIntakesSchema.episodeId,
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
          gte(medicationIntakesSchema.takenAt, rangeStartUtc),
          lt(medicationIntakesSchema.takenAt, rangeEndExclusiveUtc),
        ),
      ),
    db
      .select({
        name: preventivePlanSchema.name,
        status: preventivePlanSchema.status,
      })
      .from(preventivePlanSchema)
      .where(
        and(
          eq(preventivePlanSchema.userId, userId),
          // "Current" in report v1 means active or paused plans.
          lt(preventivePlanSchema.createdAt, rangeEndExclusiveUtc),
        ),
      )
      .orderBy(desc(preventivePlanSchema.createdAt))
      .limit(100),
    db
      .select({
        type: questionnaireResponseSchema.type,
        scoreTotal: questionnaireResponseSchema.scoreTotal,
        takenAt: questionnaireResponseSchema.takenAt,
      })
      .from(questionnaireResponseSchema)
      .where(eq(questionnaireResponseSchema.userId, userId))
      .orderBy(desc(questionnaireResponseSchema.takenAt))
      .limit(200),
    db
      .select({
        displayName: userSchema.displayName,
      })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1),
    outcomesService.computeOutcomes({
      userId,
      from: range.from,
      to: range.to,
      windowDays: totalDays,
    }),
    db
      .select()
      .from(cycleSettingsSchema)
      .where(eq(cycleSettingsSchema.userId, userId))
      .limit(1),
    db
      .select({
        localDate: cycleBleedingDaySchema.localDate,
        bleeding: cycleBleedingDaySchema.bleeding,
      })
      .from(cycleBleedingDaySchema)
      .where(
        and(
          eq(cycleBleedingDaySchema.userId, userId),
          gte(cycleBleedingDaySchema.localDate, cycleTimelineFromDb),
          lte(cycleBleedingDaySchema.localDate, cycleTimelineToDb),
        ),
      ),
    db
      .select({
        localDate: dailyDiaryEntrySchema.localDate,
      })
      .from(dailyDiaryEntrySchema)
      .where(
        and(
          eq(dailyDiaryEntrySchema.userId, userId),
          eq(dailyDiaryEntrySchema.dayType, 'migraine_day'),
          gte(dailyDiaryEntrySchema.localDate, cycleTimelineFromDb),
          lte(dailyDiaryEntrySchema.localDate, cycleTimelineToDb),
        ),
      ),
    db
      .select({
        startTime: episodeSchema.startTime,
        attackType: episodeSchema.attackType,
      })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, userId),
          gte(episodeSchema.startTime, cycleTimelineStartUtc),
          lt(episodeSchema.startTime, cycleTimelineEndExclusiveUtc),
        ),
      ),
    config.appointmentPrepId
      ? db
          .select({
            appointmentDate: appointmentPrepSchema.appointmentDate,
            visitLabel: appointmentPrepSchema.visitLabel,
            clinicianName: appointmentPrepSchema.clinicianName,
            visitReason: appointmentPrepSchema.visitReason,
            topConcerns: appointmentPrepSchema.topConcerns,
            doctorQuestions: appointmentPrepSchema.doctorQuestions,
            personalNotes: appointmentPrepSchema.personalNotes,
            generatedSnapshot: appointmentPrepSchema.generatedSnapshot,
          })
          .from(appointmentPrepSchema)
          .where(
            and(
              eq(appointmentPrepSchema.id, config.appointmentPrepId),
              eq(appointmentPrepSchema.userId, userId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  const diaryByDate = new Map<string, { dayType: string; impact: number | null }>();
  for (const row of diaryRows) {
    const localDate = DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!;
    diaryByDate.set(localDate, {
      dayType: row.dayType,
      impact: row.impact ?? null,
    });
  }

  const medsByEpisodeId = new Map<number, string[]>();
  const acuteMedUsage = new Map<string, Set<string>>();
  for (const intake of medIntakes) {
    const medName = sanitizeReportText(
      intake.medicationName ?? intake.customName ?? intake.canonicalName ?? '',
      80,
    );
    if (!medName) {
      continue;
    }

    const localDay = DateTime.fromJSDate(intake.takenAt, { zone: timezone }).toISODate()!;
    if (!acuteMedUsage.has(medName)) {
      acuteMedUsage.set(medName, new Set());
    }
    acuteMedUsage.get(medName)!.add(localDay);

    if (typeof intake.episodeId === 'number') {
      const existing = medsByEpisodeId.get(intake.episodeId) ?? [];
      existing.push(medName);
      medsByEpisodeId.set(intake.episodeId, existing);
    }
  }

  const attacksRows: ClinicianAttackRow[] = episodes.map((episode) => {
    const date = DateTime.fromJSDate(episode.startTime, { zone: timezone }).toISODate()!;
    const durationHours = episode.endTime
      ? Number(
          DateTime.fromJSDate(episode.endTime)
            .diff(DateTime.fromJSDate(episode.startTime), 'hours')
            .hours
            .toFixed(1),
        )
      : null;

    const medicationsFromEpisode = (episode.medications ?? [])
      .map(entry => sanitizeReportText(entry?.name ?? '', 80))
      .filter(Boolean);
    const medicationsFromIntakes = medsByEpisodeId.get(episode.id) ?? [];
    const uniqueAcuteMeds = [...new Set([...medicationsFromEpisode, ...medicationsFromIntakes])].slice(0, 6);

    return {
      date,
      durationHours: Number.isFinite(durationHours) ? durationHours : null,
      maxSeverity: episode.intensity,
      symptoms: sanitizeReportTextArray(episode.symptoms ?? [], 6),
      acuteMeds: uniqueAcuteMeds,
      effectiveness: null,
      impact: diaryByDate.get(date)?.impact ?? null,
    };
  });

  const questionnaireSnapshot = {
    hit6: pickQuestionnaire(questionnaires, 'HIT6'),
    midas: pickQuestionnaire(questionnaires, 'MIDAS'),
    msq: pickQuestionnaire(questionnaires, 'MSQ21'),
  };

  const outcomesPack = toClinicianOutcomesPack(outcomes);
  const moh = calculateMohGuardrail(outcomesPack.acuteMedicationDays);
  const trackedDays = outcomesPack.coverage.recordedDays;
  const missingDays = outcomesPack.coverage.missingDays;
  const trackedPct = Math.round((trackedDays / Math.max(1, outcomesPack.coverage.totalDays)) * 100);

  const topAcuteMeds = [...acuteMedUsage.entries()]
    .map(([name, usageDays]) => ({ name, usageDays: usageDays.size }))
    .sort((a, b) => b.usageDays - a.usageDays || a.name.localeCompare(b.name))
    .slice(0, 8);

  const weeklyAttackStarts = buildWeeklyAttackStarts(attacksRows, timezone, range.from, range.to);
  const cycleSettings = cycleSettingsRows[0] ?? null;
  const cycleEnabledForExport = !!(cycleSettings?.enabled && cycleSettings?.includeInExports);
  const windowStart = cycleSettings?.perimenstrualWindowStartDays ?? -2;
  const windowEnd = cycleSettings?.perimenstrualWindowEndDays ?? 3;

  const bleedingSet = new Set(
    cycleBleedingRows
      .filter(row => row.bleeding)
      .map(row => DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!),
  );
  const migraineSet = new Set(
    cycleMigraineRows.map(row => DateTime.fromJSDate(row.localDate, { zone: 'UTC' }).toISODate()!),
  );
  const bleedingStartDates = computeBleedingStartDates(bleedingSet);
  const attackDates = cycleAttackRows
    .filter(row => row.attackType === 'migraine')
    .map(row => DateTime.fromJSDate(row.startTime, { zone: timezone }).toISODate()!)
    .sort((a, b) => a.localeCompare(b));
  let attacksInWindow = 0;
  for (const attackDate of attackDates) {
    const nearestStart = findNearestStartDate(attackDate, bleedingStartDates);
    if (isInPerimenstrualWindow(attackDate, nearestStart, windowStart, windowEnd)) {
      attacksInWindow += 1;
    }
  }
  const cycleHistogram = [...buildRelativeAttackHistogram(attackDates, bleedingStartDates, -5, 7).entries()]
    .map(([relativeDay, count]) => ({ relativeDay, count }));
  const cycleTimeline: Array<{ date: string; bleeding: boolean; migraine: boolean }> = [];
  let timelineCursor = cycleTimelineFrom;
  while (timelineCursor <= cycleTimelineTo) {
    const ymd = timelineCursor.toISODate()!;
    cycleTimeline.push({
      date: ymd,
      bleeding: bleedingSet.has(ymd),
      migraine: migraineSet.has(ymd),
    });
    timelineCursor = timelineCursor.plus({ days: 1 });
  }
  const hormoneProfile = cycleSettings && cycleSettings.hormoneProfile !== CycleHormoneProfile.UNKNOWN && cycleSettings.hormoneProfile !== CycleHormoneProfile.PREFER_NOT_TO_SAY
    ? cycleSettings.hormoneProfile
    : null;

  const currentPreventives = preventives
    .filter(row => row.status === 'active' || row.status === 'paused')
    .map(row => sanitizeReportText(row.name, 80))
    .filter(Boolean)
    .slice(0, 12);

  const pages: ClinicianAttackRow[][] = [];
  for (let i = 0; i < attacksRows.length; i += ATTACKS_PAGE_SIZE) {
    pages.push(attacksRows.slice(i, i + ATTACKS_PAGE_SIZE));
  }

  const displayName = sanitizeReportText(userRows[0]?.displayName ?? '', 80) || null;
  const appointmentPrepRow = appointmentPrepRows[0];
  const appointmentPrep = appointmentPrepRow
    ? {
        appointmentDate: dbDateToYmd(appointmentPrepRow.appointmentDate),
        visitLabel: sanitizeReportText(appointmentPrepRow.visitLabel ?? '', 120) || null,
        clinicianName: sanitizeReportText(appointmentPrepRow.clinicianName ?? '', 120) || null,
        visitReason: sanitizeReportText(appointmentPrepRow.visitReason ?? '', 500) || null,
        topConcerns: sanitizeReportTextArray(appointmentPrepRow.topConcerns ?? [], 8),
        doctorQuestions: sanitizeReportTextArray(appointmentPrepRow.doctorQuestions ?? [], 8),
        personalNotes: sanitizeReportText(appointmentPrepRow.personalNotes ?? '', 1000) || null,
        generatedSnapshot: appointmentPrepRow.generatedSnapshot,
      }
    : null;
  const generatedAtIso = new Date().toISOString();
  const sections = resolveSections(config).filter(section => cycleEnabledForExport || section !== 'cycle_hormones');

  return {
    title: 'Migrennity Clinician Report',
    generatedAtIso,
    timezone,
    config,
    appointmentPrep,
    range: {
      from: range.from,
      to: range.to,
      label: `${range.from} to ${range.to}`,
    },
    sections,
    identity: {
      name: displayName,
    },
    dataQuality: {
      totalDays: outcomesPack.coverage.totalDays,
      trackedDays,
      missingDays,
      trackedPct,
      qualityLine: `${trackedDays}/${outcomesPack.coverage.totalDays} tracked days (${trackedPct}%)`,
    },
    outcomes: {
      mmd: outcomesPack.mmd,
      mhd: outcomesPack.mhd,
      acuteMedicationDays: outcomesPack.acuteMedicationDays,
    },
    moh,
    questionnaires: questionnaireSnapshot,
    medications: {
      currentPreventives,
      topAcuteMeds,
    },
    trends: {
      weeklyAttackStarts,
    },
    attacks: {
      total: attacksRows.length,
      pageSize: ATTACKS_PAGE_SIZE,
      pages,
    },
    diary: {
      days: [...diaryByDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, row]) => ({
          date,
          dayType: row.dayType,
          impact: row.impact,
        })),
    },
    cycleHormones: cycleEnabledForExport
      ? {
          timeline: cycleTimeline,
          attacksInWindow,
          totalAttacks: attackDates.length,
          windowStart,
          windowEnd,
          hormoneProfile,
          histogram: cycleHistogram,
        }
      : null,
    disclaimers: [
      'This report is informational only and is not a diagnosis.',
      'Please discuss all treatment decisions with a licensed clinician.',
    ],
  };
}

function findNearestStartDate(date: string, startDates: string[]): string | null {
  if (startDates.length === 0) {
    return null;
  }
  let best: string | null = null;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const start of startDates) {
    const distance = Math.abs(DateTime.fromISO(date).diff(DateTime.fromISO(start), 'days').days);
    if (distance < minDistance) {
      minDistance = distance;
      best = start;
    }
  }
  return best;
}

function pickQuestionnaire(
  rows: Array<{ type: string; scoreTotal: number | null; takenAt: Date }>,
  type: 'HIT6' | 'MIDAS' | 'MSQ21',
) {
  const row = rows.find(item => item.type === type);
  return {
    score: row?.scoreTotal ?? null,
    takenAt: row?.takenAt?.toISOString() ?? null,
  };
}

function buildWeeklyAttackStarts(
  attacks: ClinicianAttackRow[],
  timezone: string,
  from: string,
  to: string,
): Array<{ weekStart: string; count: number }> {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('week');
  const end = DateTime.fromISO(to, { zone: timezone }).endOf('week');
  const counts = new Map<string, number>();
  let cursor = start;
  while (cursor <= end) {
    counts.set(cursor.toISODate()!, 0);
    cursor = cursor.plus({ weeks: 1 });
  }

  for (const attack of attacks) {
    const key = DateTime.fromISO(attack.date, { zone: timezone }).startOf('week').toISODate()!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => ({ weekStart, count }));
}
