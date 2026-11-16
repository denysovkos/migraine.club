import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { factorEventSchema, factorSchema, FactorType } from '@/models/Schema';

export class FactorError extends Error {
  code: 'CONSENT_REQUIRED';
  constructor(code: 'CONSENT_REQUIRED', message: string) {
    super(message);
    this.code = code;
  }
}

export const LogFactorSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  type: z.enum([FactorType.TRIGGER, FactorType.PROTECTOR, FactorType.SYMPTOM]),
  occurredAt: z.string().datetime().optional(),
});

export type LogFactorInput = z.infer<typeof LogFactorSchema>;

export class FactorService {
  /**
   * Log a factor event, reusing the user's existing factor with the same
   * name and type when one is already active.
   */
  async log(
    userId: string,
    input: LogFactorInput,
  ): Promise<{ factorId: string; eventId: string; occurredAt: Date }> {
    if (!(await hasHealthDataConsent(userId))) {
      throw new FactorError('CONSENT_REQUIRED', 'Health data consent required');
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    return db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: factorSchema.id })
        .from(factorSchema)
        .where(
          and(
            eq(factorSchema.userId, userId),
            eq(factorSchema.displayName, input.displayName),
            eq(factorSchema.type, input.type),
            eq(factorSchema.isActive, true),
          ),
        )
        .limit(1);

      let factorId = existing[0]?.id ?? null;
      if (!factorId) {
        const inserted = await tx
          .insert(factorSchema)
          .values({
            userId,
            key: null,
            type: input.type,
            displayName: input.displayName,
            isActive: true,
          })
          .returning({ id: factorSchema.id });
        factorId = inserted[0]!.id;
      }

      const [event] = await tx
        .insert(factorEventSchema)
        .values({
          userId,
          factorId,
          occurredAt,
          source: 'diary',
          intensity: null,
        })
        .returning({
          id: factorEventSchema.id,
          occurredAt: factorEventSchema.occurredAt,
        });

      return { factorId, eventId: event!.id, occurredAt: event!.occurredAt };
    });
  }
}

export const factorService = new FactorService();
