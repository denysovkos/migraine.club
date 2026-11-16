import { auth, clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  communityCommentSchema,
  communityPostSchema,
  communityVoteSchema,
  cycleBleedingDaySchema,
  cycleSettingsSchema,
  doctorShareLinkSchema,
  episodeSchema,
  userConsentSchema,
  userSchema,
  userWeatherSettingsSchema,
  weatherPainIndexSnapshotSchema,
} from '@/models/Schema';

// DELETE /api/user/delete-account - Delete user account and all associated data
export async function DELETE() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info({ userId }, 'Starting account deletion');

    // Begin cascading deletion in the correct order to handle foreign keys
    // 1. Delete community votes
    await db.delete(communityVoteSchema).where(eq(communityVoteSchema.userId, userId));

    // 2. Delete community comments
    await db.delete(communityCommentSchema).where(eq(communityCommentSchema.authorId, userId));

    // 3. Delete community posts
    await db.delete(communityPostSchema).where(eq(communityPostSchema.authorId, userId));

    // 4. Delete doctor share links
    await db.delete(doctorShareLinkSchema).where(eq(doctorShareLinkSchema.userId, userId));

    // 5. Delete weather pain index snapshots
    await db.delete(weatherPainIndexSnapshotSchema).where(eq(weatherPainIndexSnapshotSchema.userId, userId));

    // 6. Delete user weather settings
    await db.delete(userWeatherSettingsSchema).where(eq(userWeatherSettingsSchema.userId, userId));

    // 7. Delete episodes (health data)
    const deletedEpisodes = await db.delete(episodeSchema).where(eq(episodeSchema.userId, userId)).returning();
    logger.info({ userId, episodesDeleted: deletedEpisodes.length }, 'Episodes deleted');

    // 8. Delete cycle data
    await db.delete(cycleBleedingDaySchema).where(eq(cycleBleedingDaySchema.userId, userId));
    await db.delete(cycleSettingsSchema).where(eq(cycleSettingsSchema.userId, userId));

    // 9. Mark all consents as withdrawn
    await db
      .update(userConsentSchema)
      .set({ withdrawnAt: new Date() })
      .where(eq(userConsentSchema.userId, userId));

    // 10. Delete user record from our database
    await db.delete(userSchema).where(eq(userSchema.id, userId));

    // 11. Delete user from Clerk
    try {
      const client = await clerkClient();
      await client.users.deleteUser(userId);
      logger.info({ userId }, 'Clerk user deleted');
    } catch (clerkError) {
      // Log but don't fail if Clerk deletion fails - data is already removed
      logger.error({ userId, error: clerkError }, 'Failed to delete Clerk user');
    }

    logger.info({ userId }, 'Account deletion completed');

    return NextResponse.json({
      success: true,
      message: 'Account and all associated data have been deleted',
    });
  } catch (error) {
    logger.error({ error }, 'Error deleting user account');
    return NextResponse.json(
      { error: 'Failed to delete account. Please try again or contact support.' },
      { status: 500 },
    );
  }
}
