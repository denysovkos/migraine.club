import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { doctorVerificationService } from '@/services/DoctorVerificationService';
import { moderationService } from '@/services/ModerationService';

const RejectSchema = z.object({
  reason: z.string().min(2).max(1000),
  adminNotes: z.string().max(4000).optional().nullable(),
  userFacingNote: z.string().max(4000).optional().nullable(),
});

// POST /api/admin/doctor-verification/applications/:id/reject
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = await moderationService.isAdmin(userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await doctorVerificationService.rejectAdmin({
      applicationId: id,
      adminUserId: userId,
      reason: parsed.data.reason,
      adminNotes: parsed.data.adminNotes ?? null,
      userFacingNote: parsed.data.userFacingNote ?? null,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    if (code === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to reject' }, { status: 500 });
  }
}
