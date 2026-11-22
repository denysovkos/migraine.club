import type { db } from '@/libs/DB';
import type { IntakeAnswers, IntakeSeededIds } from '@/models/intake';
import type { MedicationClassType } from '@/models/Schema';
import type { LocalDateString } from '@/services/localDate';

import { eq, inArray, isNotNull } from 'drizzle-orm';

import { factorSchema, MedicationClass, medicationsCatalogSchema, userMedicationsSchema } from '@/models/Schema';
import { preventivePlansService } from '@/services/preventives/PreventivePlansService';

/** How many acute meds get pinned to Quick Kit. */
const PIN_LIMIT = 3;

/** The transaction object every call in this file actually receives. */
type SeedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Free-form `medications_catalog.tags` values that unambiguously imply a
 * clinical medication class. Anything else (or no match) keeps the caller's
 * explicit `medicationClass`, or the safe default.
 */
const CLASS_BY_CATALOG_TAG: Record<string, MedicationClassType> = {
  triptan: MedicationClass.TRIPTAN,
  ergotamine: MedicationClass.ERGOTAMINE,
  opioid: MedicationClass.OPIOID,
  combination_analgesic: MedicationClass.COMBINATION_ANALGESIC,
};

/** Same normalisation the canonical writer applies (src/app/api/user-medications/route.ts). */
function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function normalizeNameKey(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const normalized = normalizeName(name);
  return normalized ? normalized.toLowerCase() : null;
}

/**
 * Writes the parts of an intake response that are genuinely domain data into the
 * tables that own them. Runs inside the caller's transaction.
 *
 * Deliberately does NOT write factor_event, episode, daily_diary_entry, or
 * user_outcome_settings baseline columns — see the F43 spec.
 */
export async function seedFromIntake(
  tx: SeedTx,
  args: { userId: string; answers: IntakeAnswers; todayYmd: string },
): Promise<IntakeSeededIds> {
  const { userId, answers, todayYmd } = args;
  const seeded: IntakeSeededIds = {
    userMedicationIds: [],
    preventivePlanIds: [],
    factorIds: [],
    at: new Date().toISOString(),
  };

  if (answers.medications) {
    const existing = await tx
      .select({
        id: userMedicationsSchema.id,
        catalogMedicationId: userMedicationsSchema.catalogMedicationId,
        customName: userMedicationsSchema.customName,
      })
      .from(userMedicationsSchema)
      .where(eq(userMedicationsSchema.userId, userId));

    const ownedCatalogIds = new Set(
      existing.map((r: any) => r.catalogMedicationId).filter(Boolean),
    );
    const ownedNames = new Set(
      existing.map((r: any) => normalizeNameKey(r.customName)).filter(Boolean),
    );

    // Batch-derive medicationClass for entries that reference a catalog
    // medication but didn't say which class it is.
    const catalogIdsNeedingClass = Array.from(new Set(
      answers.medications.acute
        .filter(e => e.catalogMedicationId && !e.medicationClass)
        .map(e => e.catalogMedicationId!),
    ));

    const catalogTagsById = new Map<string, string[]>();
    if (catalogIdsNeedingClass.length > 0) {
      const catalogRows = await tx
        .select({ id: medicationsCatalogSchema.id, tags: medicationsCatalogSchema.tags })
        .from(medicationsCatalogSchema)
        .where(inArray(medicationsCatalogSchema.id, catalogIdsNeedingClass));

      for (const row of catalogRows as any[]) {
        catalogTagsById.set(row.id, row.tags ?? []);
      }
    }

    function deriveMedicationClass(
      catalogId: string | null,
      explicit: MedicationClassType | undefined,
    ): MedicationClassType {
      if (explicit) {
        return explicit;
      }
      if (catalogId) {
        for (const tag of catalogTagsById.get(catalogId) ?? []) {
          const mapped = CLASS_BY_CATALOG_TAG[tag];
          if (mapped) {
            return mapped;
          }
        }
      }
      return MedicationClass.NON_OPIOID_SIMPLE_ANALGESIC;
    }

    let pinned = 0;
    for (const entry of answers.medications.acute) {
      const catalogId = entry.catalogMedicationId ?? null;

      // Neither identifier — the canonical writer refuses this shape too
      // (src/app/api/user-medications/route.ts); skip rather than write a
      // nameless, unmatchable row.
      if (!catalogId && !entry.customName) {
        continue;
      }

      const nameKey = normalizeNameKey(entry.customName);

      if (catalogId && ownedCatalogIds.has(catalogId)) {
        continue;
      }
      if (!catalogId && nameKey && ownedNames.has(nameKey)) {
        continue;
      }

      const [row] = await tx
        .insert(userMedicationsSchema)
        .values({
          userId,
          catalogMedicationId: catalogId,
          customName: entry.customName ? normalizeName(entry.customName) : null,
          defaultDose: entry.defaultDose ?? null,
          defaultUnit: entry.defaultUnit ?? null,
          defaultUnitIsCustom: entry.defaultUnitIsCustom ?? false,
          medicationClass: deriveMedicationClass(catalogId, entry.medicationClass),
          isAcute: true,
          isPinned: pinned < PIN_LIMIT,
        })
        .returning({ id: userMedicationsSchema.id });

      if (row) {
        seeded.userMedicationIds.push(row.id);
        if (catalogId) {
          ownedCatalogIds.add(catalogId);
        }
        if (nameKey) {
          ownedNames.add(nameKey);
        }
        pinned += 1;
      }
    }

    for (const plan of answers.medications.preventive) {
      const created = await preventivePlansService.createPlan(
        userId,
        {
          catalogMedicationId: plan.catalogMedicationId ?? null,
          name: plan.name,
          kind: plan.kind,
          doseText: plan.doseText ?? null,
          scheduleType: plan.scheduleType,
          schedulePayload: (plan.schedulePayload ?? {}) as any,
          startDate: plan.startDate ?? (todayYmd as LocalDateString),
          reminderTimes: [],
          remindersEnabled: false,
        },
        tx,
      );
      seeded.preventivePlanIds.push(created.id);
    }
  }

  if (answers.triggers) {
    for (const label of answers.triggers.custom) {
      const key = `intake.trigger:${label.trim().toLowerCase().replace(/\s+/g, '_')}`;
      const [row] = await tx
        .insert(factorSchema)
        .values({ userId, key, type: 'trigger', displayName: label.trim(), isActive: true })
        // factor_user_key_uidx is partial (WHERE key IS NOT NULL): the
        // conflict target must repeat the predicate or Postgres cannot use it.
        .onConflictDoNothing({ target: [factorSchema.userId, factorSchema.key], where: isNotNull(factorSchema.key) })
        .returning({ id: factorSchema.id });

      if (row) {
        seeded.factorIds.push(row.id);
      }
    }
  }

  return seeded;
}
