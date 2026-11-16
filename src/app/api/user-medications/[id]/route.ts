import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { userMedicationsSchema } from '@/models/Schema';

const UpdateUserMedicationSchema = z.object({
  defaultDose: z.string().trim().min(1).max(100).nullable().optional(),
  defaultUnit: z.string().trim().min(1).max(50).nullable().optional(),
  defaultUnitIsCustom: z.boolean().optional(),
  medicationClass: z.enum([
    'triptan',
    'ergotamine',
    'combination_analgesic',
    'opioid',
    'non_opioid_simple_analgesic',
  ]).optional(),
  isAcute: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const body = await request.json();
  const input = UpdateUserMedicationSchema.parse(body);

  const [existing] = await db
    .select({ id: userMedicationsSchema.id })
    .from(userMedicationsSchema)
    .where(and(eq(userMedicationsSchema.userId, userId), eq(userMedicationsSchema.id, id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db
    .update(userMedicationsSchema)
    .set({
      defaultDose: input.defaultDose === undefined ? undefined : input.defaultDose,
      defaultUnit: input.defaultUnit === undefined ? undefined : input.defaultUnit,
      defaultUnitIsCustom: input.defaultUnitIsCustom === undefined ? undefined : input.defaultUnitIsCustom,
      medicationClass: input.medicationClass === undefined ? undefined : input.medicationClass,
      isAcute: input.isAcute === undefined ? undefined : input.isAcute,
      isPinned: input.isPinned === undefined ? undefined : input.isPinned,
    })
    .where(and(eq(userMedicationsSchema.userId, userId), eq(userMedicationsSchema.id, id)));

  logger.info({ userId, userMedicationId: id }, 'User medication updated');
  return NextResponse.json({ success: true });
}

export const dynamic = 'force-dynamic';
