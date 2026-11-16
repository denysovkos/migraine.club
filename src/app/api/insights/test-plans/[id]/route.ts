import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { insightTestPlanSchema, InsightTestPlanStatus } from '@/models/Schema';

const PatchSchema = z.object({
  status: z.enum([InsightTestPlanStatus.COMPLETED, InsightTestPlanStatus.CANCELLED]).optional(),
  notes: z.string().max(1000).optional(),
  reminderEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json({ error: 'Health data consent required.' }, { status: 403 });
  }

  const body = await request.json();
  const input = PatchSchema.parse(body);
  const id = (await context.params).id;

  const updates: Record<string, any> = {
    updatedAt: new Date(),
  };
  if (input.status) {
    updates.status = input.status;
    if (input.status === InsightTestPlanStatus.COMPLETED) {
      updates.completedAt = new Date();
    }
  }
  if (Object.hasOwn(input, 'notes')) {
    updates.notes = input.notes ?? null;
  }
  if (Object.hasOwn(input, 'reminderEnabled')) {
    updates.reminderEnabled = input.reminderEnabled;
  }

  await db
    .update(insightTestPlanSchema)
    .set(updates)
    .where(and(eq(insightTestPlanSchema.userId, userId), eq(insightTestPlanSchema.id, id)));

  if (input.status === InsightTestPlanStatus.COMPLETED) {
    logger.info({ metric: 'test_mode_completed', userId, planId: id }, 'Test mode completed');
  }

  return NextResponse.json({ ok: true });
}
