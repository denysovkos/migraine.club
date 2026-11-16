import { and, asc, eq, gte, lt, or } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  acuteDosesSchema,
  doseOutcomesSchema,
  episodeSchema,
  medicationsCatalogSchema,
  userMedicationsSchema,
} from '@/models/Schema';

export type AttackDoseOutcomeModel = {
  doseId: string;
  medicationId: string;
  medicationLabel: string;
  medicationClass: string;
  takenAt: string;
  dose: string | null;
  unit: string | null;
  unitIsCustom: boolean;
  notes: string | null;
  outcome: {
    helped: 'yes' | 'partly' | 'no';
    backToNormalFunction: boolean | null;
    timeToReliefMinutes: number | null;
    notes: string | null;
    updatedAt: string;
  } | null;
  neededSecondDose: boolean;
  neededRescue: boolean;
};

export type AttackTreatmentModel = {
  attackId: number;
  doses: AttackDoseOutcomeModel[];
  flags: {
    anySecondDose: boolean;
    anyRescue: boolean;
  };
};

export async function getAttackTreatmentModel(attackId: number): Promise<AttackTreatmentModel> {
  const [attack] = await db
    .select({
      id: episodeSchema.id,
      userId: episodeSchema.userId,
      startTime: episodeSchema.startTime,
      endTime: episodeSchema.endTime,
      isOngoing: episodeSchema.isOngoing,
    })
    .from(episodeSchema)
    .where(eq(episodeSchema.id, attackId))
    .limit(1);

  if (!attack) {
    return {
      attackId,
      doses: [],
      flags: {
        anySecondDose: false,
        anyRescue: false,
      },
    };
  }

  const effectiveEnd = attack.isOngoing ? new Date() : (attack.endTime ?? new Date());

  const rows = await db
    .select({
      doseId: acuteDosesSchema.id,
      medicationId: acuteDosesSchema.medicationId,
      medicationLabel: userMedicationsSchema.customName,
      canonicalName: medicationsCatalogSchema.canonicalName,
      medicationClass: userMedicationsSchema.medicationClass,
      takenAt: acuteDosesSchema.takenAt,
      dose: acuteDosesSchema.dose,
      unit: acuteDosesSchema.unit,
      unitIsCustom: acuteDosesSchema.unitIsCustom,
      notes: acuteDosesSchema.notes,
      outcomeHelped: doseOutcomesSchema.helped,
      backToNormalFunction: doseOutcomesSchema.backToNormalFunction,
      timeToReliefMinutes: doseOutcomesSchema.timeToReliefMinutes,
      outcomeNotes: doseOutcomesSchema.notes,
      outcomeUpdatedAt: doseOutcomesSchema.updatedAt,
    })
    .from(acuteDosesSchema)
    .innerJoin(
      userMedicationsSchema,
      eq(acuteDosesSchema.medicationId, userMedicationsSchema.id),
    )
    .leftJoin(
      doseOutcomesSchema,
      eq(acuteDosesSchema.id, doseOutcomesSchema.doseId),
    )
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .where(
      and(
        eq(acuteDosesSchema.userId, attack.userId),
        or(
          and(
            gte(acuteDosesSchema.takenAt, attack.startTime),
            lt(acuteDosesSchema.takenAt, effectiveEnd),
          ),
          eq(acuteDosesSchema.attackId, attackId),
        ),
      ),
    )
    .orderBy(asc(acuteDosesSchema.takenAt));

  const doses: AttackDoseOutcomeModel[] = rows.map(row => ({
    doseId: row.doseId,
    medicationId: row.medicationId,
    medicationLabel: row.medicationLabel || row.canonicalName || 'Medication',
    medicationClass: row.medicationClass,
    takenAt: row.takenAt.toISOString(),
    dose: row.dose ?? null,
    unit: row.unit ?? null,
    unitIsCustom: row.unitIsCustom,
    notes: row.notes ?? null,
    outcome: row.outcomeHelped
      ? {
          helped: row.outcomeHelped,
          backToNormalFunction: row.backToNormalFunction ?? null,
          timeToReliefMinutes: row.timeToReliefMinutes ?? null,
          notes: row.outcomeNotes ?? null,
          updatedAt: row.outcomeUpdatedAt?.toISOString() ?? row.takenAt.toISOString(),
        }
      : null,
    neededSecondDose: false,
    neededRescue: false,
  }));

  const byMedication = new Map<string, AttackDoseOutcomeModel[]>();
  for (const dose of doses) {
    const arr = byMedication.get(dose.medicationId) ?? [];
    arr.push(dose);
    byMedication.set(dose.medicationId, arr);
  }

  for (const group of byMedication.values()) {
    for (let i = 0; i < group.length - 1; i++) {
      const current = group[i]!;
      const next = group[i + 1]!;
      const delta = new Date(next.takenAt).getTime() - new Date(current.takenAt).getTime();
      if (delta >= 0 && delta <= 24 * 60 * 60 * 1000) {
        current.neededSecondDose = true;
      }
    }
  }

  for (let i = 0; i < doses.length; i++) {
    const current = doses[i]!;
    const later = doses.slice(i + 1);
    const hasLaterDifferentMedication = later.some(d => d.medicationId !== current.medicationId);
    const lowResponse = current.outcome?.helped === 'no' || current.outcome?.helped === 'partly';
    current.neededRescue = Boolean(hasLaterDifferentMedication && lowResponse);
  }

  return {
    attackId,
    doses,
    flags: {
      anySecondDose: doses.some(d => d.neededSecondDose),
      anyRescue: doses.some(d => d.neededRescue),
    },
  };
}
