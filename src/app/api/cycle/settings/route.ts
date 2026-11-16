import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { CycleHormoneProfile, CyclePrivacyMode } from '@/models/Schema';
import { cycleService } from '@/services/cycle/CycleService';

export const dynamic = 'force-dynamic';

const SettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  includeInExports: z.boolean().optional(),
  privacyMode: z.enum([CyclePrivacyMode.LOCAL_ONLY, CyclePrivacyMode.ACCOUNT_SYNC]).optional(),
  perimenstrualWindowStartDays: z.number().int().optional(),
  perimenstrualWindowEndDays: z.number().int().optional(),
  hormoneProfile: z.enum([
    CycleHormoneProfile.UNKNOWN,
    CycleHormoneProfile.NONE,
    CycleHormoneProfile.COMBINED_PILL,
    CycleHormoneProfile.PROGESTIN_ONLY_PILL,
    CycleHormoneProfile.HORMONAL_IUD,
    CycleHormoneProfile.IMPLANT,
    CycleHormoneProfile.INJECTION,
    CycleHormoneProfile.PATCH_RING,
    CycleHormoneProfile.HRT,
    CycleHormoneProfile.OTHER,
    CycleHormoneProfile.PREFER_NOT_TO_SAY,
  ]).optional(),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await cycleService.getSettings(userId);
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const patch = SettingsPatchSchema.parse(await request.json());
    const settings = await cycleService.upsertSettings({ userId, patch });
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 400 });
  }
}
