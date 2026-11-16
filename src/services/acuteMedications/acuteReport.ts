import type { MedicationClassType } from '@/models/Schema';
import { and, eq, gte, lt } from 'drizzle-orm';

import { DateTime } from 'luxon';
import { db } from '@/libs/DB';
import {
  acuteDosesSchema,
  doseOutcomesSchema,
  medicationsCatalogSchema,
  userMedicationsSchema,
} from '@/models/Schema';

type ReportMode = 'rolling30' | 'calendarMonth';

type DoseRow = {
  doseId: string;
  medicationId: string;
  medicationLabel: string;
  medicationClass: MedicationClassType;
  takenAt: Date;
  helped: 'yes' | 'partly' | 'no' | null;
  timeToReliefMinutes: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function getAcuteMedsReport(args: {
  userId: string;
  mode: ReportMode;
  now: Date;
}) {
  const timezone = 'Europe/Berlin';
  const nowLocal = DateTime.fromJSDate(args.now, { zone: timezone });
  const rangeStartLocal = args.mode === 'calendarMonth'
    ? nowLocal.startOf('month')
    : nowLocal.startOf('day').minus({ days: 29 });
  const rangeEndLocalExclusive = args.mode === 'calendarMonth'
    ? nowLocal.endOf('month').plus({ milliseconds: 1 })
    : nowLocal.endOf('day').plus({ milliseconds: 1 });

  const rows = await db
    .select({
      doseId: acuteDosesSchema.id,
      medicationId: acuteDosesSchema.medicationId,
      customName: userMedicationsSchema.customName,
      canonicalName: medicationsCatalogSchema.canonicalName,
      medicationClass: userMedicationsSchema.medicationClass,
      takenAt: acuteDosesSchema.takenAt,
      helped: doseOutcomesSchema.helped,
      timeToReliefMinutes: doseOutcomesSchema.timeToReliefMinutes,
    })
    .from(acuteDosesSchema)
    .innerJoin(
      userMedicationsSchema,
      eq(acuteDosesSchema.medicationId, userMedicationsSchema.id),
    )
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .leftJoin(
      doseOutcomesSchema,
      eq(acuteDosesSchema.id, doseOutcomesSchema.doseId),
    )
    .where(
      and(
        eq(acuteDosesSchema.userId, args.userId),
        eq(userMedicationsSchema.isAcute, true),
        gte(acuteDosesSchema.takenAt, rangeStartLocal.toUTC().toJSDate()),
        lt(acuteDosesSchema.takenAt, rangeEndLocalExclusive.toUTC().toJSDate()),
      ),
    );

  const normalizedRows: DoseRow[] = rows.map(row => ({
    doseId: row.doseId,
    medicationId: row.medicationId,
    medicationLabel: row.customName || row.canonicalName || 'Medication',
    medicationClass: row.medicationClass,
    takenAt: row.takenAt,
    helped: row.helped ?? null,
    timeToReliefMinutes: row.timeToReliefMinutes ?? null,
  }));

  const byMedication = new Map<string, DoseRow[]>();
  for (const row of normalizedRows) {
    const arr = byMedication.get(row.medicationId) ?? [];
    arr.push(row);
    byMedication.set(row.medicationId, arr);
  }

  const medications = [...byMedication.entries()].map(([medicationId, doseRows]) => {
    const usageDays = new Set(
      doseRows.map(r => DateTime.fromJSDate(r.takenAt, { zone: timezone }).toISODate()!),
    ).size;
    const outcomesCount = doseRows.filter(r => r.helped !== null).length;
    const successCount = doseRows.filter(r => r.helped === 'yes').length;
    const timeToRelief = doseRows
      .map(r => r.timeToReliefMinutes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    const sortedByTime = [...doseRows].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    let secondDoseCount = 0;
    for (let i = 0; i < sortedByTime.length - 1; i++) {
      const delta = sortedByTime[i + 1]!.takenAt.getTime() - sortedByTime[i]!.takenAt.getTime();
      if (delta >= 0 && delta <= 24 * 60 * 60 * 1000) {
        secondDoseCount += 1;
      }
    }

    return {
      medicationId,
      medicationLabel: doseRows[0]!.medicationLabel,
      medicationClass: doseRows[0]!.medicationClass,
      usageDays,
      doses: doseRows.length,
      successRate: outcomesCount === 0 ? null : successCount / outcomesCount,
      medianTimeToReliefMinutes: median(timeToRelief),
      needingSecondDosePct: doseRows.length === 0 ? 0 : secondDoseCount / doseRows.length,
    };
  });

  const byClass = new Map<MedicationClassType, Set<string>>();
  for (const row of normalizedRows) {
    const set = byClass.get(row.medicationClass) ?? new Set<string>();
    set.add(DateTime.fromJSDate(row.takenAt, { zone: timezone }).toISODate()!);
    byClass.set(row.medicationClass, set);
  }

  const classSummary = [...byClass.entries()].map(([medicationClass, localDays]) => ({
    medicationClass,
    usageDays: localDays.size,
  }));

  return {
    mode: args.mode,
    timezone,
    range: {
      from: rangeStartLocal.toISODate()!,
      to: rangeEndLocalExclusive.minus({ days: 1 }).toISODate()!,
    },
    medications: medications.sort((a, b) => b.usageDays - a.usageDays),
    classes: classSummary.sort((a, b) => b.usageDays - a.usageDays),
  };
}
