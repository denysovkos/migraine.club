import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { withIdempotency } from '@/app/api/_helpers/idempotency';
import { painReadingService } from '@/services/episodes/PainReadingService';
import { painReadingErrorResponse, parseEpisodeId } from './helpers';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/episodes/:id/pain-readings - pain timeline of one attack, oldest first
export async function GET(_request: Request, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const episodeId = parseEpisodeId((await params).id);
  if (episodeId === null) {
    return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
  }
  try {
    const readings = await painReadingService.list(userId, episodeId);
    return NextResponse.json({ readings });
  } catch (error) {
    return painReadingErrorResponse(error, 'listing');
  }
}

// POST /api/episodes/:id/pain-readings - record the pain level at a point in time.
// Wrapped so readings logged offline (attack mode) are replayed at most once.
export async function POST(request: Request, ctx: Ctx) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withIdempotency(request, userId, 'episodes/:id/pain-readings', async () => {
    const episodeId = parseEpisodeId((await ctx.params).id);
    if (episodeId === null) {
      return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    try {
      const result = await painReadingService.add(userId, episodeId, body);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return painReadingErrorResponse(error, 'creating');
    }
  });
}
