import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { CycleFlow } from '@/models/Schema';
import { cycleService } from '@/services/cycle/CycleService';

export const dynamic = 'force-dynamic';

const ToggleSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const UpsertSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bleeding: z.boolean(),
  flow: z.enum([
    CycleFlow.UNSPECIFIED,
    CycleFlow.LIGHT,
    CycleFlow.MEDIUM,
    CycleFlow.HEAVY,
  ]).optional(),
});

const FlowSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  flow: z.enum([
    CycleFlow.UNSPECIFIED,
    CycleFlow.LIGHT,
    CycleFlow.MEDIUM,
    CycleFlow.HEAVY,
  ]),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = ToggleSchema.parse(await request.json());
    const day = await cycleService.toggleBleedingDay({
      userId,
      localDate: body.localDate,
    });
    return NextResponse.json(day);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to toggle bleeding day' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = UpsertSchema.parse(await request.json());
    const day = await cycleService.setBleedingDay({
      userId,
      localDate: body.localDate,
      bleeding: body.bleeding,
      flow: body.flow,
    });
    return NextResponse.json(day);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to save bleeding day' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = FlowSchema.parse(await request.json());
    const day = await cycleService.setFlow({
      userId,
      localDate: body.localDate,
      flow: body.flow,
    });
    return NextResponse.json(day);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const localDate = searchParams.get('localDate');
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return NextResponse.json({ error: 'Invalid localDate' }, { status: 400 });
  }

  await cycleService.deleteBleedingDay({ userId, localDate });
  return NextResponse.json({ ok: true });
}
