import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { acuteDosesSchema, doseOutcomesSchema } from '@/models/Schema';

const DoseOutcomeSchema = z.object({
  doseId: z.string().guid(),
  helped: z.enum(['yes', 'partly', 'no']),
  backToNormalFunction: z.boolean().nullable().optional(),
  timeToReliefMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function sanitizeNotes(input: string | null | undefined): string | null {
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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasConsent = await hasHealthDataConsent(userId);
  if (!hasConsent) {
    return NextResponse.json(
      { error: 'Health data consent required', code: 'CONSENT_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const input = DoseOutcomeSchema.parse(body);

    const [dose] = await db
      .select({ id: acuteDosesSchema.id })
      .from(acuteDosesSchema)
      .where(
        and(
          eq(acuteDosesSchema.id, input.doseId),
          eq(acuteDosesSchema.userId, userId),
        ),
      )
      .limit(1);

    if (!dose) {
      return NextResponse.json({ error: 'Dose not found' }, { status: 404 });
    }

    const [result] = await db
      .insert(doseOutcomesSchema)
      .values({
        userId,
        doseId: input.doseId,
        helped: input.helped,
        backToNormalFunction: input.backToNormalFunction ?? null,
        timeToReliefMinutes: input.timeToReliefMinutes ?? null,
        notes: sanitizeNotes(input.notes),
      })
      .onConflictDoUpdate({
        target: doseOutcomesSchema.doseId,
        set: {
          helped: input.helped,
          backToNormalFunction: input.backToNormalFunction ?? null,
          timeToReliefMinutes: input.timeToReliefMinutes ?? null,
          notes: sanitizeNotes(input.notes),
          updatedAt: new Date(),
        },
      })
      .returning({ id: doseOutcomesSchema.id });

    logger.info({ userId, doseId: input.doseId }, 'Dose outcome upserted');
    return NextResponse.json({ outcomeId: result?.id, doseId: input.doseId }, { status: 200 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }
    logger.error({ error, userId }, 'Failed to upsert dose outcome');
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
