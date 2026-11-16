import type { SupportedLanguages, ThemePreferences } from '@/models/Schema';
import { auth, currentUser } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { userProfileService } from '@/services/UserProfileService';
import { isValidDisplayName } from '@/utils/displayNameGenerator';

import { updateProfileSchema } from './validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/profile - Get the current user's profile
 *
 * Returns the user's profile data including display name and preferred language.
 * If the profile doesn't exist, it will be created automatically.
 */
export async function GET(request: Request) {
  let userId: string | null = null;

  try {
    const authResult = await auth();
    userId = authResult.userId;

    if (!userId) {
      logger.warn('Profile GET: No userId in auth result');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    logger.info({ userId }, 'Profile GET: Fetching profile');

    // Fetch Clerk user to get firstName, lastName, username for display name derivation
    const clerkUser = await currentUser();
    const acceptLanguage = request.headers.get('accept-language');

    const profile = await userProfileService.getOrCreateProfile(userId, {
      firstName: clerkUser?.firstName,
      lastName: clerkUser?.lastName,
      username: clerkUser?.username,
      clerkLocale: clerkUser?.publicMetadata?.locale as string | undefined,
      acceptLanguage,
    });

    logger.info({ userId, displayName: profile.displayName }, 'Profile GET: Success');

    return NextResponse.json({
      id: profile.id,
      displayName: profile.displayName,
      preferredLanguage: profile.preferredLanguage,
      themePreference: profile.themePreference,
      isDoctor: profile.isDoctor,
      isDoctorVerified: profile.isDoctorVerified,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error({ userId, error }, 'Profile GET: Error fetching/creating user profile');
    console.error('Error fetching user profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/user/profile - Update the current user's profile
 *
 * Accepts displayName and/or preferredLanguage in the request body.
 */
export async function PUT(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const body = await request.json();

    // Validate input
    const result = updateProfileSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { displayName, preferredLanguage, themePreference } = result.data;

    // Additional validation for display name
    if (displayName !== undefined && !isValidDisplayName(displayName)) {
      return NextResponse.json(
        { error: 'Invalid display name' },
        { status: 400 },
      );
    }

    const updatedProfile = await userProfileService.updateProfile(userId, {
      displayName,
      preferredLanguage: preferredLanguage as typeof SupportedLanguages[number] | undefined,
      themePreference: themePreference as typeof ThemePreferences[number] | undefined,
    });

    if (!updatedProfile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: updatedProfile.id,
      displayName: updatedProfile.displayName,
      preferredLanguage: updatedProfile.preferredLanguage,
      themePreference: updatedProfile.themePreference,
      isDoctor: updatedProfile.isDoctor,
      isDoctorVerified: updatedProfile.isDoctorVerified,
      createdAt: updatedProfile.createdAt.toISOString(),
      updatedAt: updatedProfile.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 },
    );
  }
}
