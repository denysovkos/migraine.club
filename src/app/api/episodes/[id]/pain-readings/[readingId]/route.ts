import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { painReadingService } from '@/services/episodes/PainReadingService';
import { painReadingErrorResponse, parseEpisodeId } from '../helpers';

// DELETE /api/episodes/:id/pain-readings/:readingId
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; readingId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id, readingId } = await params;
  const episodeId = parseEpisodeId(id);
  if (episodeId === null || !z.string().uuid().safeParse(readingId).success) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }
  try {
    const peakIntensity = await painReadingService.remove(userId, episodeId, readingId);
    return NextResponse.json({ success: true, peakIntensity });
  } catch (error) {
    return painReadingErrorResponse(error, 'deleting');
  }
}
