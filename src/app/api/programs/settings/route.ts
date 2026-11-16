import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  notificationsConfig: z
    .object({
      windDown: z.boolean().optional(),
      morningCheckIn: z.boolean().optional(),
      onsetNudge: z.boolean().optional(),
      weeklyDigest: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const patch = PatchSchema.parse(await request.json());
    const settings = await programSettingsService.update(userId, patch);
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
