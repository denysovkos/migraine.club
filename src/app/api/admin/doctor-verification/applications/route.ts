import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { doctorVerificationApplicationSchema } from '@/models/Schema';
import { moderationService } from '@/services/ModerationService';

// GET /api/admin/doctor-verification/applications?status=pending|approved|rejected|revoked
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = await moderationService.isAdmin(userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'pending';

  const rows = await db
    .select({
      id: doctorVerificationApplicationSchema.id,
      userId: doctorVerificationApplicationSchema.userId,
      status: doctorVerificationApplicationSchema.status,
      fullName: doctorVerificationApplicationSchema.fullName,
      country: doctorVerificationApplicationSchema.country,
      specialty: doctorVerificationApplicationSchema.specialty,
      verificationMethod: doctorVerificationApplicationSchema.verificationMethod,
      submittedAt: doctorVerificationApplicationSchema.submittedAt,
      createdAt: doctorVerificationApplicationSchema.createdAt,
    })
    .from(doctorVerificationApplicationSchema)
    .where(eq(doctorVerificationApplicationSchema.status, status as any))
    .orderBy(desc(doctorVerificationApplicationSchema.submittedAt));

  // Hide drafts (submittedAt null) from admin list
  const submitted = rows.filter(r => r.submittedAt !== null);

  return NextResponse.json({
    applications: submitted.map(r => ({
      ...r,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
