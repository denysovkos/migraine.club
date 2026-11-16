import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { unsubscribeSchema } from '@/app/api/push/validation';
import { logger } from '@/libs/Logger';
import { pushService } from '@/server/push/push.service';

/**
 * POST /api/push/unsubscribe - Unsubscribe from push notifications
 *
 * Removes a specific push subscription for the authenticated user.
 * Requires authentication via Clerk.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const body = await request.json();

    // Validate request data
    const result = unsubscribeSchema.safeParse(body);
    if (!result.success) {
      logger.warn(
        { userId, errors: result.error.flatten().fieldErrors },
        'Invalid unsubscribe request data',
      );
      return NextResponse.json(
        {
          error: 'Invalid request data',
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { endpoint } = result.data;

    // Unsubscribe the user from this endpoint
    const deletedCount = await pushService.unsubscribe(userId, endpoint);

    logger.info(
      { userId, deletedCount },
      'User unsubscribed from push notifications',
    );

    return NextResponse.json({
      ok: true,
      deletedCount,
    });
  } catch (error) {
    logger.error({ error }, 'Error unsubscribing from push notifications');
    console.error('Error unsubscribing from push notifications:', error);
    return NextResponse.json(
      { error: 'Failed to unsubscribe from push notifications' },
      { status: 500 },
    );
  }
}
