import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { outcomesService } from '@/services/OutcomesService';

const MonthlyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

/**
 * GET /api/outcomes/monthly?months=12
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = MonthlyQuerySchema.parse({
      months: searchParams.get('months') ?? undefined,
    });

    const result = await outcomesService.computeMonthly({ userId, months: query.months });
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
