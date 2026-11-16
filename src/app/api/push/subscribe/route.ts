import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { subscribeSchema } from '@/app/api/push/validation';
import { logger } from '@/libs/Logger';
import { pushService } from '@/server/push/push.service';

/**
 * POST /api/push/subscribe - Subscribe to push notifications
 *
 * Creates or updates a push subscription for the authenticated user's device.
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

    // Validate subscription data
    const result = subscribeSchema.safeParse(body);
    if (!result.success) {
      logger.warn(
        { userId, errors: result.error.flatten().fieldErrors },
        'Invalid push subscription data',
      );
      return NextResponse.json(
        {
          error: 'Invalid subscription data',
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { endpoint, keys, expirationTime } = result.data;

    // Get user agent for device identification
    const userAgent = request.headers.get('user-agent') ?? undefined;

    // Subscribe the user
    const subscription = await pushService.subscribe(
      userId,
      { endpoint, keys, expirationTime },
      userAgent,
    );

    logger.info(
      { userId, subscriptionId: subscription.id },
      'User subscribed to push notifications',
    );

    return NextResponse.json({
      ok: true,
      subscriptionId: subscription.id,
    });
  } catch (error) {
    logger.error({ error }, 'Error subscribing to push notifications');
    console.error('Error subscribing to push notifications:', error);
    return NextResponse.json(
      { error: 'Failed to subscribe to push notifications' },
      { status: 500 },
    );
  }
}
