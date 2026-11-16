import type { PushSubscription, SendResult } from 'web-push';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { pushSubscriptionSchema } from '@/models/Schema';

/**
 * Payload structure for push notifications
 */
export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  data?: Record<string, unknown>;
};

/**
 * Result of sending push notifications to a user
 */
export type SendPushResult = {
  sentCount: number;
  removedCount: number;
  failedCount: number;
  errors: Array<{
    endpoint: string;
    error: string;
    statusCode?: number;
  }>;
};

/**
 * Database subscription record type
 */
type DbSubscription = typeof pushSubscriptionSchema.$inferSelect;

/**
 * Initialize web-push with VAPID details if configured
 */
function initializeWebPush(): boolean {
  const publicKey = Env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = Env.VAPID_PRIVATE_KEY;
  const subject = Env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn(
        'VAPID keys not configured. Push notifications will not work. '
        + 'Generate keys with: npx web-push generate-vapid-keys',
      );
    }
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

// Track initialization status
let isInitialized = false;

/**
 * Ensure web-push is initialized before use
 */
function ensureInitialized(): boolean {
  if (!isInitialized) {
    isInitialized = initializeWebPush();
  }
  return isInitialized;
}

/**
 * Convert database subscription to web-push format
 */
function toWebPushSubscription(sub: DbSubscription): PushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

/**
 * PushService - Handles Web Push notification operations
 */
export class PushService {
  /**
   * Check if push notifications are properly configured
   */
  isConfigured(): boolean {
    return ensureInitialized();
  }

  /**
   * Subscribe a user's device to push notifications
   */
  async subscribe(
    userId: string,
    subscription: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
      expirationTime?: number | null;
    },
    userAgent?: string,
  ): Promise<DbSubscription> {
    logger.info(
      { userId, endpoint: subscription.endpoint.substring(0, 50) },
      'Subscribing user to push notifications',
    );

    // Upsert by endpoint (one subscription per endpoint)
    const [result] = await db
      .insert(pushSubscriptionSchema)
      .values({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime ?? null,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionSchema.endpoint,
        set: {
          userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          expirationTime: subscription.expirationTime ?? null,
          userAgent: userAgent ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    logger.info(
      { userId, subscriptionId: result?.id },
      'Push subscription created/updated',
    );

    return result!;
  }

  /**
   * Unsubscribe a specific endpoint for a user
   *
   * @param userId - Clerk user ID
   * @param endpoint - Push endpoint to unsubscribe
   */
  async unsubscribe(userId: string, endpoint: string): Promise<number> {
    logger.info(
      { userId, endpoint: endpoint.substring(0, 50) },
      'Unsubscribing user from push notifications',
    );

    const result = await db
      .delete(pushSubscriptionSchema)
      .where(eq(pushSubscriptionSchema.endpoint, endpoint))
      .returning();

    // Verify the deleted subscription belonged to this user for security
    const deletedCount = result.filter(r => r.userId === userId).length;

    logger.info(
      { userId, deletedCount },
      'Push subscription(s) removed',
    );

    return deletedCount;
  }

  /**
   * Remove all subscriptions for a user
   *
   * @param userId - Clerk user ID
   */
  async unsubscribeAll(userId: string): Promise<number> {
    logger.info({ userId }, 'Removing all push subscriptions for user');

    const result = await db
      .delete(pushSubscriptionSchema)
      .where(eq(pushSubscriptionSchema.userId, userId))
      .returning();

    logger.info(
      { userId, deletedCount: result.length },
      'All push subscriptions removed for user',
    );

    return result.length;
  }

  /**
   * Get all subscriptions for a user
   *
   * @param userId - Clerk user ID
   */
  async getSubscriptions(userId: string): Promise<DbSubscription[]> {
    return db
      .select()
      .from(pushSubscriptionSchema)
      .where(eq(pushSubscriptionSchema.userId, userId));
  }

  /**
   * Send a push notification to all of a user's subscribed devices
   *
   * @param userId - Clerk user ID
   * @param payload - Notification payload
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<SendPushResult> {
    if (!ensureInitialized()) {
      logger.warn('Push notifications not configured, skipping send');
      return {
        sentCount: 0,
        removedCount: 0,
        failedCount: 0,
        errors: [{ endpoint: '*', error: 'VAPID not configured' }],
      };
    }

    const subscriptions = await this.getSubscriptions(userId);

    if (subscriptions.length === 0) {
      logger.info({ userId }, 'No push subscriptions found for user');
      return {
        sentCount: 0,
        removedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    logger.info(
      { userId, subscriptionCount: subscriptions.length },
      'Sending push notification to user',
    );

    return this.sendToSubscriptions(subscriptions, payload);
  }

  /**
   * Send a push notification to specific subscriptions
   *
   * @param subscriptions - Array of subscription records
   * @param payload - Notification payload
   */
  async sendToSubscriptions(
    subscriptions: DbSubscription[],
    payload: PushPayload,
  ): Promise<SendPushResult> {
    const result: SendPushResult = {
      sentCount: 0,
      removedCount: 0,
      failedCount: 0,
      errors: [],
    };

    const payloadString = JSON.stringify(payload);
    const subscriptionsToRemove: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await this.sendNotification(toWebPushSubscription(sub), payloadString);
          result.sentCount++;
        } catch (error) {
          const sendError = error as SendResult & { statusCode?: number; body?: string };

          // 410 Gone or 404 Not Found - subscription is no longer valid
          if (sendError.statusCode === 410 || sendError.statusCode === 404) {
            logger.info(
              { endpoint: sub.endpoint.substring(0, 50), statusCode: sendError.statusCode },
              'Push subscription expired, marking for removal',
            );
            subscriptionsToRemove.push(sub.endpoint);
            result.removedCount++;
          } else {
            logger.error(
              {
                endpoint: sub.endpoint.substring(0, 50),
                statusCode: sendError.statusCode,
                body: sendError.body,
              },
              'Failed to send push notification',
            );
            result.failedCount++;
            result.errors.push({
              endpoint: sub.endpoint,
              error: sendError.body || String(error),
              statusCode: sendError.statusCode,
            });
          }
        }
      }),
    );

    // Clean up stale subscriptions
    if (subscriptionsToRemove.length > 0) {
      await this.removeStaleSubscriptions(subscriptionsToRemove);
    }

    logger.info(
      {
        sentCount: result.sentCount,
        removedCount: result.removedCount,
        failedCount: result.failedCount,
      },
      'Push notification send complete',
    );

    return result;
  }

  /**
   * Send a notification to a single subscription
   */
  private async sendNotification(
    subscription: PushSubscription,
    payload: string,
  ): Promise<SendResult> {
    return webpush.sendNotification(subscription, payload, {
      TTL: 60 * 60 * 24, // 24 hours
      urgency: 'normal',
      // Without this the socket can stay open indefinitely and stall the whole cron run
      timeout: 10_000,
    });
  }

  /**
   * Remove stale/expired subscriptions from the database
   */
  private async removeStaleSubscriptions(endpoints: string[]): Promise<void> {
    for (const endpoint of endpoints) {
      try {
        await db
          .delete(pushSubscriptionSchema)
          .where(eq(pushSubscriptionSchema.endpoint, endpoint));
      } catch (error) {
        logger.error(
          { endpoint: endpoint.substring(0, 50), error },
          'Failed to remove stale subscription',
        );
      }
    }
  }
}

// Export singleton instance
export const pushService = new PushService();
