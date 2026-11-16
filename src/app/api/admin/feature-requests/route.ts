import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { featureRequestSchema } from '@/models/Schema';
import { moderationService } from '@/services/ModerationService';
import { UpdateFeatureRequestResolutionSchema } from '@/types/FeatureRequest';

// GET /api/admin/feature-requests - list all feature requests
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = await moderationService.isAdmin(userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requests = await db
    .select({
      id: featureRequestSchema.id,
      userId: featureRequestSchema.userId,
      title: featureRequestSchema.title,
      description: featureRequestSchema.description,
      resolution: featureRequestSchema.resolution,
      createdAt: featureRequestSchema.createdAt,
      updatedAt: featureRequestSchema.updatedAt,
    })
    .from(featureRequestSchema)
    .orderBy(desc(featureRequestSchema.createdAt));

  return NextResponse.json({
    requests: requests.map(request => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })),
  });
}

// PATCH /api/admin/feature-requests - update request resolution
export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = await moderationService.isAdmin(userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = UpdateFeatureRequestResolutionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(featureRequestSchema)
    .set({ resolution: parsed.data.resolution })
    .where(eq(featureRequestSchema.id, parsed.data.requestId))
    .returning({
      id: featureRequestSchema.id,
      resolution: featureRequestSchema.resolution,
      updatedAt: featureRequestSchema.updatedAt,
    });

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    request: {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
