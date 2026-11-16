import type { UserRoleType } from '@/types/Community';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { moderationService } from '@/services/ModerationService';

export const dynamic = 'force-dynamic';

// GET /api/moderation/role - get current user's role
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await moderationService.getUserRole(userId);

    return NextResponse.json<{
      role: UserRoleType;
      isModerator: boolean;
      isAdmin: boolean;
    }>({
      role: role ?? 'user',
      isModerator: role === 'moderator' || role === 'admin',
      isAdmin: role === 'admin',
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching user role');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
