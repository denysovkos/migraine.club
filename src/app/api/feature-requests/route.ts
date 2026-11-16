import { auth } from '@clerk/nextjs/server';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { FeatureRequestResolution, featureRequestSchema } from '@/models/Schema';
import { CreateFeatureRequestSchema } from '@/types/FeatureRequest';

const MAX_ACTIVE_REQUESTS = 3;

const activeResolutions = [
  FeatureRequestResolution.SENT,
  FeatureRequestResolution.IN_REVIEW,
] as const;

// GET /api/feature-requests - list current user's feature requests
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requests = await db
    .select({
      id: featureRequestSchema.id,
      title: featureRequestSchema.title,
      description: featureRequestSchema.description,
      resolution: featureRequestSchema.resolution,
      createdAt: featureRequestSchema.createdAt,
      updatedAt: featureRequestSchema.updatedAt,
    })
    .from(featureRequestSchema)
    .where(eq(featureRequestSchema.userId, userId))
    .orderBy(desc(featureRequestSchema.createdAt));

  return NextResponse.json({
    requests: requests.map(request => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })),
  });
}

// POST /api/feature-requests - create a new feature request for current user
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = CreateFeatureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [activeCountRow] = await db
    .select({ count: count() })
    .from(featureRequestSchema)
    .where(
      and(
        eq(featureRequestSchema.userId, userId),
        inArray(featureRequestSchema.resolution, [...activeResolutions]),
      ),
    );

  const activeCount = activeCountRow?.count ?? 0;
  if (activeCount >= MAX_ACTIVE_REQUESTS) {
    return NextResponse.json(
      {
        error: 'Active request limit reached',
        code: 'ACTIVE_REQUEST_LIMIT_REACHED',
        maxActiveRequests: MAX_ACTIVE_REQUESTS,
      },
      { status: 409 },
    );
  }

  const [created] = await db
    .insert(featureRequestSchema)
    .values({
      userId,
      title: parsed.data.title,
      description: parsed.data.description,
      resolution: FeatureRequestResolution.SENT,
    })
    .returning({
      id: featureRequestSchema.id,
      title: featureRequestSchema.title,
      description: featureRequestSchema.description,
      resolution: featureRequestSchema.resolution,
      createdAt: featureRequestSchema.createdAt,
      updatedAt: featureRequestSchema.updatedAt,
    });

  if (!created) {
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
  }

  return NextResponse.json(
    {
      request: {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
