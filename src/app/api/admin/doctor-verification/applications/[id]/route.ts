import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { doctorVerificationApplicationSchema, doctorVerificationFileSchema } from '@/models/Schema';
import { moderationService } from '@/services/ModerationService';

// GET /api/admin/doctor-verification/applications/:id - admin-only details
export async function GET(
  _request: Request,
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

  const [app] = await db
    .select()
    .from(doctorVerificationApplicationSchema)
    .where(eq(doctorVerificationApplicationSchema.id, id))
    .limit(1);

  if (!app) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [file] = await db
    .select()
    .from(doctorVerificationFileSchema)
    .where(eq(doctorVerificationFileSchema.applicationId, app.id))
    .limit(1);

  return NextResponse.json({
    application: {
      ...app,
      submittedAt: app.submittedAt ? app.submittedAt.toISOString() : null,
      reviewedAt: app.reviewedAt ? app.reviewedAt.toISOString() : null,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
      file: file
        ? {
            id: file.id,
            applicationId: file.applicationId,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            createdAt: file.createdAt.toISOString(),
          }
        : null,
    },
  });
}
