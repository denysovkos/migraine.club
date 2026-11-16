import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getProgramDefinitions } from '@/services/programs/programDefinitions';
import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const programs = getProgramDefinitions().map(d => ({
    id: d.frontmatter.id,
    title: d.frontmatter.title,
    shape: d.frontmatter.shape,
    durationWeeks: d.frontmatter.durationWeeks,
    citationCount: d.frontmatter.citations.length,
  }));
  return NextResponse.json({ programs });
}
