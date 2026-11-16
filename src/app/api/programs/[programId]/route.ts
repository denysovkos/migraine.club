import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getProgramBody, getProgramDefinition } from '@/services/programs/programDefinitions';
import { programEnrollmentService } from '@/services/programs/programEnrollmentService';
import { programSettingsService } from '@/services/programs/programSettingsService';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ programId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await programSettingsService.get(userId);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'Module disabled' }, { status: 404 });
  }
  const { programId } = await params;
  const def = getProgramDefinition(programId);
  if (!def) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Locale: ?locale=fr or fall back to Accept-Language. Body falls back to en
  // when no localised file exists.
  const url = new URL(request.url);
  const explicitLocale = url.searchParams.get('locale');
  const acceptLang = request.headers.get('accept-language')?.split(',')[0]?.split('-')[0];
  const locale = explicitLocale ?? acceptLang ?? 'en';

  const active = await programEnrollmentService.getActive(userId, programId);
  return NextResponse.json({
    id: def.frontmatter.id,
    title: def.frontmatter.title,
    shape: def.frontmatter.shape,
    durationWeeks: def.frontmatter.durationWeeks,
    defaultTarget: def.frontmatter.defaultTarget,
    citations: def.frontmatter.citations,
    disclaimer: def.frontmatter.disclaimer,
    body: getProgramBody(programId, locale) ?? def.body,
    activeEnrollment: active,
  });
}
