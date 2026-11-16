import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getServerTranslator } from '@/libs/i18nMessages';
import { logger } from '@/libs/Logger';
import { pushService } from '@/server/push/push.service';
import { userProfileService } from '@/services/UserProfileService';

/**
 * POST /api/push/test - Send a test push notification
 *
 * Sends a test notification to all of the authenticated user's subscribed devices.
 * Useful for verifying push notifications are working correctly.
 * Requires authentication via Clerk.
 */
export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Check if push is configured
    if (!pushService.isConfigured()) {
      logger.warn({ userId }, 'Push notifications not configured');
      return NextResponse.json(
        { error: 'Push notifications are not configured on this server' },
        { status: 503 },
      );
    }

    const profile = await userProfileService.getProfile(userId);
    const t = await getServerTranslator(profile?.preferredLanguage, 'Push');

    // Send test notification
    const result = await pushService.sendToUser(userId, {
      title: t('test.title'),
      body: t('test.body'),
      icon: '/android-chrome-192x192.png',
      badge: '/android-icon-72x72.png',
      url: '/dashboard',
      tag: 'test-notification',
      requireInteraction: false,
    });

    logger.info(
      {
        userId,
        sentCount: result.sentCount,
        removedCount: result.removedCount,
        failedCount: result.failedCount,
      },
      'Test notification sent',
    );

    // Return summary
    return NextResponse.json({
      ok: true,
      sentCount: result.sentCount,
      removedCount: result.removedCount,
      failedCount: result.failedCount,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    logger.error({ error }, 'Error sending test notification');
    console.error('Error sending test notification:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 },
    );
  }
}
