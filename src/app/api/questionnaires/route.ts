import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionnaireResponseSchema } from '@/models/Schema';
import { QuestionnaireType, scoreQuestionnaire } from '@/services/questionnaires/scoring';

const QuestionnaireTypeSchema = z.nativeEnum(QuestionnaireType);

const ListQuerySchema = z.object({
  type: QuestionnaireTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/questionnaires?type=HIT6&limit=50
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = ListQuerySchema.parse({
      type: searchParams.get('type') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    const conditions = [eq(questionnaireResponseSchema.userId, userId)];
    if (q.type) {
      conditions.push(eq(questionnaireResponseSchema.type, q.type));
    }

    const rows = await db
      .select()
      .from(questionnaireResponseSchema)
      .where(and(...conditions))
      .orderBy(desc(questionnaireResponseSchema.takenAt))
      .limit(q.limit);

    return NextResponse.json({
      responses: rows.map(r => ({
        id: r.id,
        type: r.type,
        takenAt: r.takenAt.toISOString(),
        periodStart: r.periodStart?.toISOString() ?? null,
        periodEnd: r.periodEnd?.toISOString() ?? null,
        answers: r.answers,
        scoreTotal: r.scoreTotal ?? null,
        scoreDetails: r.scoreDetails ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const CreateQuestionnaireSchema = z.object({
  type: QuestionnaireTypeSchema,
  takenAt: z.string().datetime().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  answers: z.unknown(),
});

/**
 * POST /api/questionnaires
 *
 * Stores raw answers + computed score (deterministic, transparent).
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = CreateQuestionnaireSchema.parse(body);

    const takenAt = data.takenAt ? new Date(data.takenAt) : new Date();

    let periodStart: Date | null = data.periodStart ? new Date(data.periodStart) : null;
    let periodEnd: Date | null = data.periodEnd ? new Date(data.periodEnd) : null;

    // MIDAS defaults to last 90 days window if not explicitly provided.
    if (data.type === QuestionnaireType.MIDAS && (!periodStart || !periodEnd)) {
      const end = DateTime.fromJSDate(takenAt);
      const start = end.minus({ days: 90 });
      periodStart = start.toJSDate();
      periodEnd = end.toJSDate();
    }

    const scored = scoreQuestionnaire({ type: data.type, answers: data.answers });

    const [inserted] = await db
      .insert(questionnaireResponseSchema)
      .values({
        userId,
        type: data.type,
        takenAt,
        periodStart,
        periodEnd,
        answers: scored.normalizedAnswers,
        scoreTotal: scored.scoreTotal,
        scoreDetails: scored.scoreDetails,
      })
      .returning();

    if (!inserted) {
      return NextResponse.json(
        { error: 'Failed to save questionnaire' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: inserted.id,
      type: inserted.type,
      takenAt: inserted.takenAt.toISOString(),
      periodStart: inserted.periodStart?.toISOString() ?? null,
      periodEnd: inserted.periodEnd?.toISOString() ?? null,
      answers: inserted.answers,
      scoreTotal: inserted.scoreTotal ?? null,
      scoreDetails: inserted.scoreDetails ?? null,
      createdAt: inserted.createdAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
