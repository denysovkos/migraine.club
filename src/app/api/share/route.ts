import crypto from 'node:crypto';

import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { doctorShareLinkSchema } from '@/models/Schema';

/**
 * Generate a secure URL-safe random token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const createShareLinkSchema = z.object({
  label: z.string().max(200).optional(),
  recipientName: z.string().max(200).optional(),
  patientDisplayName: z.string().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  appointmentPrepId: z.string().guid().optional(),
});

// POST /api/share - Create a new share link
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = createShareLinkSchema.parse(body);

    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validatedData.expiresInDays);

    const [shareLink] = await db
      .insert(doctorShareLinkSchema)
      .values({
        userId,
        token,
        label: validatedData.label,
        recipientName: validatedData.recipientName,
        patientDisplayName: validatedData.patientDisplayName,
        expiresAt,
        dateRangeStart: validatedData.dateRangeStart
          ? new Date(validatedData.dateRangeStart)
          : null,
        dateRangeEnd: validatedData.dateRangeEnd
          ? new Date(validatedData.dateRangeEnd)
          : null,
        appointmentPrepId: validatedData.appointmentPrepId ?? null,
      })
      .returning();

    if (!shareLink) {
      return NextResponse.json(
        { error: 'Failed to create share link' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: shareLink.id,
      token: shareLink.token,
      expiresAt: shareLink.expiresAt.toISOString(),
      label: shareLink.label,
      recipientName: shareLink.recipientName,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 },
      );
    }
    console.error('Error creating share link:', error);
    return NextResponse.json(
      { error: 'Failed to create share link' },
      { status: 500 },
    );
  }
}

// GET /api/share - List user's share links
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const shareLinks = await db
      .select({
        id: doctorShareLinkSchema.id,
        token: doctorShareLinkSchema.token,
        label: doctorShareLinkSchema.label,
        recipientName: doctorShareLinkSchema.recipientName,
        expiresAt: doctorShareLinkSchema.expiresAt,
        accessCount: doctorShareLinkSchema.accessCount,
        lastAccessedAt: doctorShareLinkSchema.lastAccessedAt,
        isRevoked: doctorShareLinkSchema.isRevoked,
        createdAt: doctorShareLinkSchema.createdAt,
      })
      .from(doctorShareLinkSchema)
      .where(eq(doctorShareLinkSchema.userId, userId))
      .orderBy(desc(doctorShareLinkSchema.createdAt));

    return NextResponse.json(shareLinks);
  } catch (error) {
    console.error('Error fetching share links:', error);
    return NextResponse.json(
      { error: 'Failed to fetch share links' },
      { status: 500 },
    );
  }
}

// DELETE /api/share - Revoke a share link by ID (passed in body)
export async function DELETE(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Missing link ID' }, { status: 400 });
    }

    // Update the link to revoked (only if it belongs to the user)
    const result = await db
      .update(doctorShareLinkSchema)
      .set({ isRevoked: true })
      .where(
        and(
          eq(doctorShareLinkSchema.id, id),
          eq(doctorShareLinkSchema.userId, userId),
        ),
      )
      .returning({ id: doctorShareLinkSchema.id });

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Share link not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking share link:', error);
    return NextResponse.json(
      { error: 'Failed to revoke share link' },
      { status: 500 },
    );
  }
}
