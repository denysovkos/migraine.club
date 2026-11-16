import { auth } from '@clerk/nextjs/server';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { medicationIntakesSchema, medicationsCatalogSchema, userMedicationsSchema } from '@/models/Schema';

function daysAgoUtc(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

const CreateUserMedicationSchema = z
  .object({
    catalogMedicationId: z.string().guid().optional(),
    customName: z.string().trim().min(1).max(200).optional(),
    defaultDose: z.string().trim().min(1).max(100).optional().nullable(),
    defaultUnit: z.string().trim().min(1).max(50).optional().nullable(),
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
  })
  .refine(d => !!d.catalogMedicationId || !!d.customName, {
    message: 'catalogMedicationId or customName is required',
  });

export async function GET() {
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

  const pinned = await db
    .select({
      id: userMedicationsSchema.id,
      label: sql<string>`coalesce(${userMedicationsSchema.customName}, ${medicationsCatalogSchema.canonicalName})`,
      defaultDose: userMedicationsSchema.defaultDose,
      defaultUnit: userMedicationsSchema.defaultUnit,
      defaultUnitIsCustom: userMedicationsSchema.defaultUnitIsCustom,
      lastUsedDose: userMedicationsSchema.lastUsedDose,
      lastUsedUnit: userMedicationsSchema.lastUsedUnit,
      lastUsedUnitIsCustom: userMedicationsSchema.lastUsedUnitIsCustom,
      lastUsedAt: userMedicationsSchema.lastUsedAt,
      medicationClass: userMedicationsSchema.medicationClass,
      isAcute: userMedicationsSchema.isAcute,
      isPinned: userMedicationsSchema.isPinned,
      createdAt: userMedicationsSchema.createdAt,
    })
    .from(userMedicationsSchema)
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .where(and(eq(userMedicationsSchema.userId, userId), eq(userMedicationsSchema.isPinned, true)))
    .orderBy(desc(userMedicationsSchema.createdAt))
    .limit(50);

  const windowStart = daysAgoUtc(90);
  const recentAgg = await db
    .select({
      userMedicationId: medicationIntakesSchema.userMedicationId,
      lastUsedAt: sql<Date>`max(${medicationIntakesSchema.takenAt})`.mapWith(v => new Date(v as any)),
    })
    .from(medicationIntakesSchema)
    .where(and(eq(medicationIntakesSchema.userId, userId), gte(medicationIntakesSchema.takenAt, windowStart)))
    .groupBy(medicationIntakesSchema.userMedicationId)
    .orderBy(desc(sql`max(${medicationIntakesSchema.takenAt})`))
    .limit(30);

  const ids = recentAgg
    .map(r => r.userMedicationId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const recentlyUsedRaw = ids.length === 0
    ? []
    : await db
        .select({
          id: userMedicationsSchema.id,
          label: sql<string>`coalesce(${userMedicationsSchema.customName}, ${medicationsCatalogSchema.canonicalName})`,
          defaultDose: userMedicationsSchema.defaultDose,
          defaultUnit: userMedicationsSchema.defaultUnit,
          defaultUnitIsCustom: userMedicationsSchema.defaultUnitIsCustom,
          lastUsedDose: userMedicationsSchema.lastUsedDose,
          lastUsedUnit: userMedicationsSchema.lastUsedUnit,
          lastUsedUnitIsCustom: userMedicationsSchema.lastUsedUnitIsCustom,
          lastUsedAt: userMedicationsSchema.lastUsedAt,
          medicationClass: userMedicationsSchema.medicationClass,
          isAcute: userMedicationsSchema.isAcute,
          isPinned: userMedicationsSchema.isPinned,
        })
        .from(userMedicationsSchema)
        .leftJoin(
          medicationsCatalogSchema,
          eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
        )
        .where(and(eq(userMedicationsSchema.userId, userId), inArray(userMedicationsSchema.id, ids)));

  const order = new Map(ids.map((id, idx) => [id, idx]));
  const recentlyUsed = [...recentlyUsedRaw].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const all = await db
    .select({
      id: userMedicationsSchema.id,
      label: sql<string>`coalesce(${userMedicationsSchema.customName}, ${medicationsCatalogSchema.canonicalName})`,
      defaultDose: userMedicationsSchema.defaultDose,
      defaultUnit: userMedicationsSchema.defaultUnit,
      defaultUnitIsCustom: userMedicationsSchema.defaultUnitIsCustom,
      lastUsedDose: userMedicationsSchema.lastUsedDose,
      lastUsedUnit: userMedicationsSchema.lastUsedUnit,
      lastUsedUnitIsCustom: userMedicationsSchema.lastUsedUnitIsCustom,
      lastUsedAt: userMedicationsSchema.lastUsedAt,
      isPinned: userMedicationsSchema.isPinned,
    })
    .from(userMedicationsSchema)
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .where(eq(userMedicationsSchema.userId, userId))
    .orderBy(desc(userMedicationsSchema.isPinned), desc(userMedicationsSchema.lastUsedAt), desc(userMedicationsSchema.createdAt))
    .limit(400);

  return NextResponse.json({ pinned, recentlyUsed, all });
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
    const input = CreateUserMedicationSchema.parse(body);

    const customName = input.customName ? normalizeName(input.customName) : undefined;

    const [existing] = await db
      .select({ id: userMedicationsSchema.id })
      .from(userMedicationsSchema)
      .where(
        and(
          eq(userMedicationsSchema.userId, userId),
          input.catalogMedicationId
            ? eq(userMedicationsSchema.catalogMedicationId, input.catalogMedicationId)
            : sql<boolean>`lower(${userMedicationsSchema.customName}) = lower(${customName ?? ''})`,
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json({ userMedicationId: existing.id }, { status: 200 });
    }

    const [created] = await db
      .insert(userMedicationsSchema)
      .values({
        userId,
        catalogMedicationId: input.catalogMedicationId ?? null,
        customName: customName ?? null,
        defaultDose: input.defaultDose ?? null,
        defaultUnit: input.defaultUnit ?? null,
        defaultUnitIsCustom: input.defaultUnitIsCustom ?? false,
        medicationClass: input.medicationClass ?? 'non_opioid_simple_analgesic',
        isAcute: input.isAcute ?? true,
        isPinned: input.isPinned ?? false,
      })
      .returning({ id: userMedicationsSchema.id });

    if (!created) {
      throw new Error('Failed to create medication');
    }

    logger.info({ userId, userMedicationId: created.id }, 'User medication created');
    return NextResponse.json({ userMedicationId: created.id }, { status: 201 });
  } catch (error: any) {
    logger.error({ error, userId }, 'Error creating user medication');
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
