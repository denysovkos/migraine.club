import type {
  CreateQuickMedicationIntakeInput,
  QuickAddSuggestion,
  UpdateMedicationIntakeInput,
} from '@/types/Medications';

import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { acuteDosesSchema, episodeSchema, medicationIntakesSchema, medicationsCatalogSchema, userMedicationsSchema } from '@/models/Schema';

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function daysAgoUtc(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function labelForUserMedication(row: {
  canonicalName: string | null;
  customName: string | null;
}): string {
  const raw = row.customName ?? row.canonicalName ?? 'Medication';
  return normalizeName(raw);
}

function computeScore(args: { count: number; lastUsedAt: Date }): number {
  // Simple scoring: prioritize frequency heavily, then recency.
  // This score is only used for client display/debug; ordering is primarily by SQL.
  return args.count * 1_000_000 + args.lastUsedAt.getTime();
}

function mostCommonDoseUnit(entries: Array<{ dose: string | null; unit: string | null; unitIsCustom: boolean }>): {
  dose: string | null;
  unit: string | null;
  unitIsCustom: boolean;
} | null {
  const key = (e: { dose: string | null; unit: string | null; unitIsCustom: boolean }) =>
    `${e.dose ?? ''}||${e.unit ?? ''}||${e.unitIsCustom ? '1' : '0'}`;

  const counts = new Map<string, { e: { dose: string | null; unit: string | null; unitIsCustom: boolean }; n: number }>();
  for (const e of entries) {
    if (!e.dose && !e.unit) {
      continue;
    }
    const k = key(e);
    const prev = counts.get(k);
    if (prev) {
      prev.n += 1;
    } else {
      counts.set(k, { e, n: 1 });
    }
  }
  if (counts.size === 0) {
    return null;
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]!.e;
}

export class QuickAddService {
  async getOngoingEpisodeId(userId: string): Promise<number | null> {
    const [row] = await db
      .select({ id: episodeSchema.id })
      .from(episodeSchema)
      .where(and(eq(episodeSchema.userId, userId), eq(episodeSchema.isOngoing, true)))
      .orderBy(desc(episodeSchema.startTime))
      .limit(1);

    return row?.id ?? null;
  }

  /**
   * The ongoing episode, but only if it had already started at `at`. A dose
   * synced late from the offline queue must not attach to an attack that
   * began after the dose was actually taken.
   */
  async getOngoingEpisodeIdAt(userId: string, at: Date): Promise<number | null> {
    const [row] = await db
      .select({ id: episodeSchema.id })
      .from(episodeSchema)
      .where(and(
        eq(episodeSchema.userId, userId),
        eq(episodeSchema.isOngoing, true),
        lte(episodeSchema.startTime, at),
      ))
      .orderBy(desc(episodeSchema.startTime))
      .limit(1);

    return row?.id ?? null;
  }

  async getSuggestions(userId: string): Promise<{ topMeds: QuickAddSuggestion[]; hasOngoingEpisode: boolean }> {
    const windowStart = daysAgoUtc(90);

    const [ongoingId, topAgg] = await Promise.all([
      this.getOngoingEpisodeId(userId),
      db
        .select({
          userMedicationId: medicationIntakesSchema.userMedicationId,
          count: sql<number>`count(*)`.mapWith(Number),
          lastUsedAt: sql<Date>`max(${medicationIntakesSchema.takenAt})`.mapWith(v => new Date(v as any)),
        })
        .from(medicationIntakesSchema)
        .where(
          and(
            eq(medicationIntakesSchema.userId, userId),
            gte(medicationIntakesSchema.takenAt, windowStart),
            isNotNull(medicationIntakesSchema.userMedicationId),
          ),
        )
        .groupBy(medicationIntakesSchema.userMedicationId)
        .orderBy(desc(sql`count(*)`), desc(sql`max(${medicationIntakesSchema.takenAt})`))
        .limit(5),
    ]);

    if (topAgg.length === 0) {
      return { topMeds: [], hasOngoingEpisode: ongoingId !== null };
    }

    const ids = topAgg
      .map(r => r.userMedicationId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (ids.length === 0) {
      return { topMeds: [], hasOngoingEpisode: ongoingId !== null };
    }

    const meds = await db
      .select({
        id: userMedicationsSchema.id,
        defaultDose: userMedicationsSchema.defaultDose,
        defaultUnit: userMedicationsSchema.defaultUnit,
        defaultUnitIsCustom: userMedicationsSchema.defaultUnitIsCustom,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(userMedicationsSchema)
      .leftJoin(
        medicationsCatalogSchema,
        eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
      )
      .where(and(eq(userMedicationsSchema.userId, userId), inArray(userMedicationsSchema.id, ids)));

    const medById = new Map(meds.map(m => [m.id, m]));

    // For just 5 items, it's fine to fetch intake history per med and compute mode/last in JS.
    const suggestions: QuickAddSuggestion[] = [];
    for (const agg of topAgg) {
      const userMedicationId = agg.userMedicationId;
      if (!userMedicationId) {
        continue;
      }

      const med = medById.get(userMedicationId);
      if (!med) {
        continue;
      }

      const intakeRows = await db
        .select({
          dose: medicationIntakesSchema.dose,
          unit: medicationIntakesSchema.unit,
          unitIsCustom: medicationIntakesSchema.unitIsCustom,
          takenAt: medicationIntakesSchema.takenAt,
        })
        .from(medicationIntakesSchema)
        .where(
          and(
            eq(medicationIntakesSchema.userId, userId),
            eq(medicationIntakesSchema.userMedicationId, userMedicationId),
            gte(medicationIntakesSchema.takenAt, windowStart),
          ),
        )
        .orderBy(desc(medicationIntakesSchema.takenAt))
        .limit(200);

      const label = labelForUserMedication({
        canonicalName: med.canonicalName ?? null,
        customName: med.customName ?? null,
      });

      // Suggested dose/unit precedence:
      // 1) user default
      // 2) mode in 90d
      // 3) last used in 90d
      let suggestedDose: string | null = med.defaultDose ?? null;
      let suggestedUnit: string | null = med.defaultUnit ?? null;
      let unitIsCustom = med.defaultUnitIsCustom ?? false;

      if (!suggestedDose && !suggestedUnit) {
        const mode = mostCommonDoseUnit(intakeRows);
        if (mode) {
          suggestedDose = mode.dose ?? null;
          suggestedUnit = mode.unit ?? null;
          unitIsCustom = mode.unitIsCustom;
        }
      }

      if (!suggestedDose && !suggestedUnit) {
        const last = intakeRows.find(r => !!r.dose || !!r.unit);
        if (last) {
          suggestedDose = last.dose ?? null;
          suggestedUnit = last.unit ?? null;
          unitIsCustom = last.unitIsCustom ?? false;
        }
      }

      suggestions.push({
        userMedicationId,
        label,
        suggestedDose,
        suggestedUnit,
        unitIsCustom,
        lastUsedAt: agg.lastUsedAt.toISOString(),
        score: computeScore({ count: agg.count, lastUsedAt: agg.lastUsedAt }),
      });
    }

    return { topMeds: suggestions, hasOngoingEpisode: ongoingId !== null };
  }

  async ensureUserMedicationForCatalog(args: {
    userId: string;
    catalogMedicationId: string;
  }): Promise<string> {
    const [existing] = await db
      .select({ id: userMedicationsSchema.id })
      .from(userMedicationsSchema)
      .where(
        and(
          eq(userMedicationsSchema.userId, args.userId),
          eq(userMedicationsSchema.catalogMedicationId, args.catalogMedicationId),
        ),
      )
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const [created] = await db
      .insert(userMedicationsSchema)
      .values({
        userId: args.userId,
        catalogMedicationId: args.catalogMedicationId,
        customName: null,
        defaultDose: null,
        defaultUnit: null,
        defaultUnitIsCustom: false,
        isPinned: false,
      })
      .returning({ id: userMedicationsSchema.id });

    if (!created) {
      throw new Error('Failed to create user medication');
    }
    return created.id;
  }

  async ensureUserMedicationForCustom(args: { userId: string; customName: string }): Promise<string> {
    const normalized = normalizeName(args.customName);

    const [existing] = await db
      .select({ id: userMedicationsSchema.id })
      .from(userMedicationsSchema)
      .where(
        and(
          eq(userMedicationsSchema.userId, args.userId),
          sql`lower(${userMedicationsSchema.customName}) = lower(${normalized})`,
        ),
      )
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const [created] = await db
      .insert(userMedicationsSchema)
      .values({
        userId: args.userId,
        catalogMedicationId: null,
        customName: normalized,
        defaultDose: null,
        defaultUnit: null,
        defaultUnitIsCustom: false,
        isPinned: false,
      })
      .returning({ id: userMedicationsSchema.id });

    if (!created) {
      throw new Error('Failed to create custom user medication');
    }
    return created.id;
  }

  async createMedicationIntake(args: { userId: string; input: CreateQuickMedicationIntakeInput }): Promise<{
    intakeId: string;
    linkedEpisodeId: number | null;
    userMedicationId: string;
  }> {
    const takenAt = args.input.takenAt ? new Date(args.input.takenAt) : new Date();

    let userMedicationId = args.input.userMedicationId;
    if (!userMedicationId && args.input.catalogMedicationId) {
      userMedicationId = await this.ensureUserMedicationForCatalog({
        userId: args.userId,
        catalogMedicationId: args.input.catalogMedicationId,
      });
    }
    if (!userMedicationId && args.input.customName) {
      userMedicationId = await this.ensureUserMedicationForCustom({
        userId: args.userId,
        customName: args.input.customName,
      });
    }
    if (!userMedicationId) {
      throw new Error('userMedicationId not resolved');
    }

    // Ownership check (important for security).
    const [owned] = await db
      .select({ id: userMedicationsSchema.id })
      .from(userMedicationsSchema)
      .where(and(eq(userMedicationsSchema.userId, args.userId), eq(userMedicationsSchema.id, userMedicationId)))
      .limit(1);
    if (!owned) {
      throw new Error('User medication not found');
    }

    let episodeId: number | null = null;
    if (args.input.episodeId) {
      const [ep] = await db
        .select({ id: episodeSchema.id })
        .from(episodeSchema)
        .where(and(eq(episodeSchema.userId, args.userId), eq(episodeSchema.id, args.input.episodeId)))
        .limit(1);
      if (!ep) {
        throw new Error('Episode not found');
      }
      episodeId = ep.id;
    } else {
      episodeId = await this.getOngoingEpisodeIdAt(args.userId, takenAt);
    }

    const [created] = await db
      .insert(medicationIntakesSchema)
      .values({
        userId: args.userId,
        userMedicationId,
        episodeId,
        takenAt,
        medicationName: null,
        dose: args.input.dose ? args.input.dose.trim() : null,
        unit: args.input.unit ? args.input.unit.trim() : null,
        unitIsCustom: args.input.unitIsCustom ?? false,
      })
      .returning({ id: medicationIntakesSchema.id });

    if (!created) {
      throw new Error('Failed to create medication intake');
    }

    const normalizedDose = args.input.dose?.trim() || null;
    const normalizedUnit = args.input.unit?.trim() || null;
    await db
      .update(userMedicationsSchema)
      .set({
        // A dose synced late from the offline queue must not move lastUsedAt backwards.
        lastUsedAt: sql`greatest(coalesce(${userMedicationsSchema.lastUsedAt}, ${takenAt}), ${takenAt})`,
        lastUsedDose: normalizedDose === null ? undefined : normalizedDose,
        lastUsedUnit: normalizedUnit === null ? undefined : normalizedUnit,
        lastUsedUnitIsCustom:
          normalizedDose !== null || normalizedUnit !== null
            ? (args.input.unitIsCustom ?? false)
            : undefined,
      })
      .where(and(eq(userMedicationsSchema.userId, args.userId), eq(userMedicationsSchema.id, userMedicationId)));

    return { intakeId: created.id, linkedEpisodeId: episodeId, userMedicationId };
  }

  async deleteMedicationIntake(args: { userId: string; intakeId: string }): Promise<boolean> {
    const [row] = await db
      .select({ id: medicationIntakesSchema.id })
      .from(medicationIntakesSchema)
      .where(and(eq(medicationIntakesSchema.userId, args.userId), eq(medicationIntakesSchema.id, args.intakeId)))
      .limit(1);

    if (!row) {
      return false;
    }

    await db
      .delete(medicationIntakesSchema)
      .where(and(eq(medicationIntakesSchema.userId, args.userId), eq(medicationIntakesSchema.id, args.intakeId)));

    return true;
  }

  async updateMedicationIntake(args: { userId: string; intakeId: string; input: UpdateMedicationIntakeInput }): Promise<boolean> {
    const takenAt = args.input.takenAt === undefined ? undefined : (args.input.takenAt ? new Date(args.input.takenAt) : undefined);
    const patch = {
      dose: args.input.dose === undefined ? undefined : args.input.dose,
      unit: args.input.unit === undefined ? undefined : args.input.unit,
      unitIsCustom: args.input.unitIsCustom === undefined ? undefined : args.input.unitIsCustom,
      takenAt,
    };

    if (args.intakeId.startsWith('acute:')) {
      const rawId = args.intakeId.slice('acute:'.length);
      const [row] = await db
        .select({ id: acuteDosesSchema.id })
        .from(acuteDosesSchema)
        .where(and(eq(acuteDosesSchema.userId, args.userId), eq(acuteDosesSchema.id, rawId)))
        .limit(1);
      if (!row) {
        return false;
      }
      await db
        .update(acuteDosesSchema)
        .set(patch)
        .where(and(eq(acuteDosesSchema.userId, args.userId), eq(acuteDosesSchema.id, rawId)));
      return true;
    }

    const intakeId = args.intakeId.startsWith('intake:') ? args.intakeId.slice('intake:'.length) : args.intakeId;
    const [row] = await db
      .select({ id: medicationIntakesSchema.id })
      .from(medicationIntakesSchema)
      .where(and(eq(medicationIntakesSchema.userId, args.userId), eq(medicationIntakesSchema.id, intakeId)))
      .limit(1);

    if (!row) {
      return false;
    }

    await db
      .update(medicationIntakesSchema)
      .set(patch)
      .where(and(eq(medicationIntakesSchema.userId, args.userId), eq(medicationIntakesSchema.id, intakeId)));

    return true;
  }
}

export const quickAddService = new QuickAddService();
