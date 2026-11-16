import { auth } from '@clerk/nextjs/server';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { userConsentSchema } from '@/models/Schema';

const ConsentTypeEnum = z.enum(['health_data', 'terms', 'privacy', 'analytics']);

const CreateConsentSchema = z.object({
  consentType: ConsentTypeEnum,
  version: z.string().default('1.0'),
});

// GET /api/user/consent - Get user's current consents
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const consents = await db
      .select()
      .from(userConsentSchema)
      .where(
        and(
          eq(userConsentSchema.userId, userId),
          isNull(userConsentSchema.withdrawnAt),
        ),
      );

    // Transform to a simple map for easier client usage
    const consentMap: Record<string, { version: string; givenAt: Date }> = {};
    for (const consent of consents) {
      consentMap[consent.consentType] = {
        version: consent.version,
        givenAt: consent.givenAt,
      };
    }

    return NextResponse.json({ consents: consentMap });
  } catch (error) {
    logger.error({ error }, 'Error fetching user consents');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/user/consent - Record a new consent
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = CreateConsentSchema.parse(body);

    // Get IP and User Agent from request for audit trail
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ipAddress = forwardedFor?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    // Check if consent already exists (and is active)
    const existingConsent = await db
      .select()
      .from(userConsentSchema)
      .where(
        and(
          eq(userConsentSchema.userId, userId),
          eq(userConsentSchema.consentType, validatedData.consentType),
          isNull(userConsentSchema.withdrawnAt),
        ),
      )
      .limit(1);

    if (existingConsent.length > 0) {
      // Update existing consent with new version/timestamp
      const [updated] = await db
        .update(userConsentSchema)
        .set({
          version: validatedData.version,
          givenAt: new Date(),
          ipAddress,
          userAgent,
        })
        .where(eq(userConsentSchema.id, existingConsent[0]!.id))
        .returning();

      logger.info(
        { userId, consentType: validatedData.consentType, action: 'updated' },
        'User consent updated',
      );

      return NextResponse.json(updated);
    }

    // Create new consent
    const [consent] = await db
      .insert(userConsentSchema)
      .values({
        userId,
        consentType: validatedData.consentType,
        version: validatedData.version,
        givenAt: new Date(),
        ipAddress,
        userAgent,
      })
      .returning();

    logger.info(
      { userId, consentType: validatedData.consentType, action: 'created' },
      'User consent created',
    );

    return NextResponse.json(consent, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      );
    }

    logger.error({ error }, 'Error creating user consent');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// DELETE /api/user/consent - Withdraw consent (mark as withdrawn)
export async function DELETE(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const consentType = searchParams.get('type');

    if (!consentType || !ConsentTypeEnum.safeParse(consentType).success) {
      return NextResponse.json(
        { error: 'Invalid consent type' },
        { status: 400 },
      );
    }

    // Mark consent as withdrawn
    const [withdrawn] = await db
      .update(userConsentSchema)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(userConsentSchema.userId, userId),
          eq(userConsentSchema.consentType, consentType as 'health_data' | 'terms' | 'privacy' | 'analytics'),
          isNull(userConsentSchema.withdrawnAt),
        ),
      )
      .returning();

    if (!withdrawn) {
      return NextResponse.json(
        { error: 'No active consent found' },
        { status: 404 },
      );
    }

    logger.info(
      { userId, consentType, action: 'withdrawn' },
      'User consent withdrawn',
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error withdrawing user consent');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
