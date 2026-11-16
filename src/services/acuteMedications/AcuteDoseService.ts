import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { acuteDosesSchema, episodeSchema, userMedicationsSchema } from '@/models/Schema';
import { recordAcuteAdherenceForAttack } from '@/services/programs/recordAcuteAdherence';

export type AcuteDoseErrorCode
  = | 'CONSENT_REQUIRED'
    | 'MEDICATION_NOT_FOUND'
    | 'ATTACK_NOT_FOUND';

export class AcuteDoseError extends Error {
  code: AcuteDoseErrorCode;
  constructor(code: AcuteDoseErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const AcuteDoseSchema = z.object({
  medicationId: z.string().guid(),
  attackId: z.number().int().positive().nullable().optional(),
  takenAt: z.string().datetime().optional(),
  dose: z.string().trim().min(1).max(100).nullable().optional(),
  unit: z.string().trim().min(1).max(50).nullable().optional(),
  unitIsCustom: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export type AcuteDoseInput = z.infer<typeof AcuteDoseSchema>;

/** Strip control characters and collapse whitespace; cap at 500 chars. */
export function sanitizeNotes(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const withoutControls = [...input]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return (code <= 31 || code === 127) ? ' ' : ch;
    })
    .join('');
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}

export class AcuteDoseService {
  private async resolveAttackId(args: {
    userId: string;
    requestedAttackId?: number | null;
  }): Promise<number | null> {
    if (!args.requestedAttackId) {
      return null;
    }

    const [episode] = await db
      .select({ id: episodeSchema.id })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.id, args.requestedAttackId),
          eq(episodeSchema.userId, args.userId),
        ),
      )
      .limit(1);

    if (!episode) {
      throw new AcuteDoseError('ATTACK_NOT_FOUND', 'Attack not found');
    }
    return episode.id;
  }

  /**
   * Record an acute dose. This is the MOH-relevant write path: doses logged
   * here count toward medication-overuse thresholds, so every caller (REST or
   * MCP) must go through it rather than inserting directly.
   */
  async create(
    userId: string,
    input: AcuteDoseInput,
  ): Promise<{ doseId: string | undefined; attackId: number | null }> {
    if (!(await hasHealthDataConsent(userId))) {
      throw new AcuteDoseError('CONSENT_REQUIRED', 'Health data consent required');
    }

    const [medication] = await db
      .select({ id: userMedicationsSchema.id, isAcute: userMedicationsSchema.isAcute })
      .from(userMedicationsSchema)
      .where(
        and(
          eq(userMedicationsSchema.id, input.medicationId),
          eq(userMedicationsSchema.userId, userId),
        ),
      )
      .limit(1);

    if (!medication) {
      throw new AcuteDoseError('MEDICATION_NOT_FOUND', 'Medication not found');
    }

    const linkedAttackId = await this.resolveAttackId({
      userId,
      requestedAttackId: input.attackId,
    });

    const [created] = await db
      .insert(acuteDosesSchema)
      .values({
        userId,
        medicationId: medication.id,
        attackId: linkedAttackId,
        takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
        dose: input.dose ?? null,
        unit: input.unit ?? null,
        unitIsCustom: input.unitIsCustom ?? false,
        notes: sanitizeNotes(input.notes),
      })
      .returning({ id: acuteDosesSchema.id });

    logger.info(
      { userId, acuteDoseId: created?.id, attackId: linkedAttackId },
      'Acute dose logged',
    );

    // Best-effort: refresh acute-med-timing adherence for the attack. Silent on errors.
    if (linkedAttackId) {
      recordAcuteAdherenceForAttack({ userId, attackId: linkedAttackId }).catch((err) => {
        logger.warn({ userId, attackId: linkedAttackId, err }, 'Failed to record acute adherence');
      });
    }

    return { doseId: created?.id, attackId: linkedAttackId };
  }

  /** Acute doses in a window, newest first. Backs the `list_medication_doses` tool. */
  async list(
    userId: string,
    args: { from?: string | null; to?: string | null; limit?: number },
  ): Promise<Array<{
    id: string;
    takenAt: Date;
    medicationId: string;
    attackId: number | null;
    dose: string | null;
    unit: string | null;
    notes: string | null;
  }>> {
    const filters = [eq(acuteDosesSchema.userId, userId)];
    if (args.from) {
      filters.push(gte(acuteDosesSchema.takenAt, new Date(args.from)));
    }
    if (args.to) {
      filters.push(lte(acuteDosesSchema.takenAt, new Date(args.to)));
    }

    return db
      .select({
        id: acuteDosesSchema.id,
        takenAt: acuteDosesSchema.takenAt,
        medicationId: acuteDosesSchema.medicationId,
        attackId: acuteDosesSchema.attackId,
        dose: acuteDosesSchema.dose,
        unit: acuteDosesSchema.unit,
        notes: acuteDosesSchema.notes,
      })
      .from(acuteDosesSchema)
      .where(and(...filters))
      .orderBy(desc(acuteDosesSchema.takenAt))
      .limit(args.limit ?? 200);
  }
}

export const acuteDoseService = new AcuteDoseService();
