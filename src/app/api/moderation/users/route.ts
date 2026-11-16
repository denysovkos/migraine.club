import type { UserSummary } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { moderationService } from '@/services/ModerationService';
import { UpdateUserRoleSchema } from '@/types/Community';

// GET /api/moderation/users - list users for role management (admin only)
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await moderationService.isAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? undefined;

    const users = await moderationService.getUsers(search);

    return NextResponse.json<{ users: UserSummary[] }>({ users });
  } catch (error) {
    logger.error({ error }, 'Error fetching users for moderation');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/moderation/users - update user role (admin only)
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await moderationService.isAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = UpdateUserRoleSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn(
        { errors: parsed.error.flatten(), userId },
        'Validation error updating user role',
      );
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Prevent admin from removing their own admin role
    if (parsed.data.userId === userId && parsed.data.role !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin role' },
        { status: 400 },
      );
    }

    const success = await moderationService.updateUserRole(userId, parsed.data);

    if (!success) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error updating user role');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
