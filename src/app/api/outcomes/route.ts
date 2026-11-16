import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { outcomesService } from '@/services/OutcomesService';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const OutcomesQuerySchema = z.object({
  from: Ymd.optional(),
  to: Ymd.optional(),
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

/**
 * GET /api/outcomes?from=YYYY-MM-DD&to=YYYY-MM-DD&windowDays=28
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = OutcomesQuerySchema.parse({
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      windowDays: searchParams.get('windowDays') ?? undefined,
    });

    const result = await outcomesService.computeOutcomes({
      userId,
      from: query.from,
      to: query.to,
      windowDays: query.windowDays,
    });

    return NextResponse.json(result);
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
