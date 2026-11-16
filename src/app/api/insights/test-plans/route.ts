import { auth } from '@clerk/nextjs/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  dailyDiaryEntrySchema,
  episodeSchema,
  factorSchema,
  InsightTestPlanDirection,
  insightTestPlanSchema,
  InsightTestPlanStatus,
} from '@/models/Schema';
import { dbDateToYmd, ymdToDbDate } from '@/services/localDate';
import { toLocalISODate } from '@/services/outcomes/localDateOverlap';
import { getUserTimezone } from '@/services/userTimezone';

const CreatePlanSchema = z.object({
  factorId: z.string().guid(),
  direction: z.enum([InsightTestPlanDirection.REDUCE, InsightTestPlanDirection.INCREASE]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationDays: z.number().int().min(7).max(60).optional(),
  notes: z.string().max(1000).optional(),
  reminderEnabled: z.boolean().optional(),
});

const ListSchema = z.object({
  status: z.enum([InsightTestPlanStatus.ACTIVE, InsightTestPlanStatus.COMPLETED, InsightTestPlanStatus.CANCELLED]).optional(),
});

function toLocalDateRange(args: { startDate: string; durationDays: number }) {
  const start = DateTime.fromISO(args.startDate, { zone: 'UTC' }).toISODate()!;
  const end = DateTime.fromISO(args.startDate, { zone: 'UTC' })
    .plus({ days: args.durationDays - 1 })
    .toISODate()!;
  const beforeStart = DateTime.fromISO(args.startDate, { zone: 'UTC' })
    .minus({ days: args.durationDays })
    .toISODate()!;
  const beforeEnd = DateTime.fromISO(args.startDate, { zone: 'UTC' })
    .minus({ days: 1 })
    .toISODate()!;
  return { start, end, beforeStart, beforeEnd };
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json({ error: 'Health data consent required.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { status } = ListSchema.parse({ status: searchParams.get('status') ?? undefined });
  const timezone = await getUserTimezone(userId);

  const whereClause = status
    ? and(
        eq(insightTestPlanSchema.userId, userId),
        eq(insightTestPlanSchema.status, status),
      )
    : eq(insightTestPlanSchema.userId, userId);

  const plans = await db
    .select({
      id: insightTestPlanSchema.id,
      factorId: insightTestPlanSchema.factorId,
      direction: insightTestPlanSchema.direction,
      startDate: insightTestPlanSchema.startDate,
      durationDays: insightTestPlanSchema.durationDays,
      notes: insightTestPlanSchema.notes,
      reminderEnabled: insightTestPlanSchema.reminderEnabled,
      status: insightTestPlanSchema.status,
      completedAt: insightTestPlanSchema.completedAt,
      createdAt: insightTestPlanSchema.createdAt,
      updatedAt: insightTestPlanSchema.updatedAt,
      factorName: factorSchema.displayName,
      factorType: factorSchema.type,
    })
    .from(insightTestPlanSchema)
    .leftJoin(factorSchema, eq(insightTestPlanSchema.factorId, factorSchema.id))
    .where(whereClause)
    .orderBy(insightTestPlanSchema.createdAt);

  const response = [];
  for (const plan of plans) {
    const startDate = dbDateToYmd(plan.startDate);
    const durationDays = plan.durationDays ?? 14;
    const ranges = toLocalDateRange({ startDate, durationDays });

    const [duringDiary, beforeDiary] = await Promise.all([
      db
        .select({ localDate: dailyDiaryEntrySchema.localDate })
        .from(dailyDiaryEntrySchema)
        .where(
          and(
            eq(dailyDiaryEntrySchema.userId, userId),
            gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(ranges.start as any)),
            lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(ranges.end as any)),
          ),
        ),
      db
        .select({ localDate: dailyDiaryEntrySchema.localDate })
        .from(dailyDiaryEntrySchema)
        .where(
          and(
            eq(dailyDiaryEntrySchema.userId, userId),
            gte(dailyDiaryEntrySchema.localDate, ymdToDbDate(ranges.beforeStart as any)),
            lte(dailyDiaryEntrySchema.localDate, ymdToDbDate(ranges.beforeEnd as any)),
          ),
        ),
    ]);

    const episodes = await db
      .select({ startTime: episodeSchema.startTime })
      .from(episodeSchema)
      .where(
        and(
          eq(episodeSchema.userId, userId),
          gte(episodeSchema.startTime, DateTime.fromISO(ranges.beforeStart, { zone: timezone }).toUTC().toJSDate()),
          lte(episodeSchema.startTime, DateTime.fromISO(ranges.end, { zone: timezone }).endOf('day').toUTC().toJSDate()),
        ),
      );

    const countStarts = (from: string, to: string) => {
      let count = 0;
      for (const ep of episodes) {
        const local = toLocalISODate({ instant: ep.startTime, timezone });
        if (local >= from && local <= to) {
          count += 1;
        }
      }
      return count;
    };

    const beforeCount = countStarts(ranges.beforeStart, ranges.beforeEnd);
    const duringCount = countStarts(ranges.start, ranges.end);
    const perWeek = (count: number) => (durationDays > 0 ? count / (durationDays / 7) : 0);

    response.push({
      id: plan.id,
      factorId: plan.factorId,
      factorName: plan.factorName ?? 'Factor',
      factorType: plan.factorType ?? 'trigger',
      direction: plan.direction,
      startDate,
      endDate: ranges.end,
      durationDays,
      notes: plan.notes ?? '',
      reminderEnabled: plan.reminderEnabled ?? true,
      status: plan.status,
      completedAt: plan.completedAt ? plan.completedAt.toISOString() : null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      comparison: {
        before: {
          attackStarts: beforeCount,
          attackStartsPerWeek: perWeek(beforeCount),
          diaryCoveragePct: durationDays > 0 ? beforeDiary.length / durationDays : 0,
        },
        during: {
          attackStarts: duringCount,
          attackStartsPerWeek: perWeek(duringCount),
          diaryCoveragePct: durationDays > 0 ? duringDiary.length / durationDays : 0,
        },
      },
    });
  }

  return NextResponse.json({ plans: response });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const consent = await hasHealthDataConsent(userId);
  if (!consent) {
    return NextResponse.json({ error: 'Health data consent required.' }, { status: 403 });
  }

  const body = await request.json();
  const input = CreatePlanSchema.parse(body);

  const [saved] = await db
    .insert(insightTestPlanSchema)
    .values({
      userId,
      factorId: input.factorId,
      direction: input.direction,
      startDate: ymdToDbDate(input.startDate as any),
      durationDays: input.durationDays ?? 14,
      notes: input.notes ?? null,
      reminderEnabled: input.reminderEnabled ?? true,
      status: InsightTestPlanStatus.ACTIVE,
      updatedAt: new Date(),
    })
    .returning();

  logger.info({ metric: 'test_mode_started', userId, factorId: input.factorId }, 'Test mode started');

  return NextResponse.json({ id: saved?.id });
}
