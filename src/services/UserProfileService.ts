import type { SupportedLanguageType, ThemePreferenceType } from '@/models/Schema';
import { currentUser } from '@clerk/nextjs/server';

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  SupportedLanguages,
  ThemePreferences,
  userSchema,
} from '@/models/Schema';
import { AppConfig } from '@/utils/AppConfig';
import { generateDisplayNameFromSeed, sanitizeDisplayName } from '@/utils/displayNameGenerator';

const MAX_RETRIES = 3;

type DbUser = typeof userSchema.$inferSelect;

export type UserProfile = {
  id: string;
  displayName: string;
  preferredLanguage: SupportedLanguageType;
  themePreference: ThemePreferenceType;
  isDoctor: boolean;
  isDoctorVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UpdateProfileInput = {
  displayName?: string;
  preferredLanguage?: SupportedLanguageType;
  themePreference?: ThemePreferenceType;
};

/**
 * Detect the best language for a user based on available signals
 */
function detectPreferredLanguage(
  clerkLocale?: string | null,
  acceptLanguage?: string | null,
): SupportedLanguageType {
  // 1. Try Clerk-provided locale
  if (clerkLocale) {
    const baseLocale = clerkLocale.split('-')[0]?.toLowerCase();
    if (baseLocale && SupportedLanguages.includes(baseLocale as SupportedLanguageType)) {
      return baseLocale as SupportedLanguageType;
    }
  }

  // 2. Try Accept-Language header
  if (acceptLanguage) {
    // Parse Accept-Language: "en-US,en;q=0.9,de;q=0.8"
    const languages = acceptLanguage.split(',').map((lang) => {
      const [code] = lang.trim().split(';');
      return code?.split('-')[0]?.toLowerCase();
    });

    for (const lang of languages) {
      if (lang && SupportedLanguages.includes(lang as SupportedLanguageType)) {
        return lang as SupportedLanguageType;
      }
    }
  }

  // 3. Default to English
  return AppConfig.defaultLocale as SupportedLanguageType;
}

/**
 * Derive a display name from Clerk user data
 */
function deriveDisplayNameFromClerk(
  userId: string,
  firstName?: string | null,
  lastName?: string | null,
  username?: string | null,
): string {
  // Try firstName + lastName
  if (firstName || lastName) {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (fullName.length >= 2) {
      return sanitizeDisplayName(fullName);
    }
  }

  // Try username
  if (username && username.length >= 2) {
    return sanitizeDisplayName(username);
  }

  // Generate a cool name based on user ID
  return generateDisplayNameFromSeed(userId);
}

function mapDbUserToProfile(dbUser: DbUser): UserProfile {
  return {
    id: dbUser.id,
    displayName: dbUser.displayName,
    preferredLanguage: dbUser.preferredLanguage,
    themePreference: dbUser.themePreference,
    isDoctor: dbUser.isDoctor,
    isDoctorVerified: dbUser.isDoctorVerified,
    createdAt: dbUser.createdAt,
    updatedAt: dbUser.updatedAt,
  };
}

export class UserProfileService {
  /**
   * Get or create a user profile for the given auth user ID.
   * This ensures every authenticated user has a profile record.
   * Uses retry logic to handle race conditions.
   */
  async getOrCreateProfile(
    authUserId: string,
    options?: {
      firstName?: string | null;
      lastName?: string | null;
      username?: string | null;
      clerkLocale?: string | null;
      acceptLanguage?: string | null;
    },
  ): Promise<UserProfile> {
    // Try to find existing profile first
    const [existing] = await db
      .select()
      .from(userSchema)
      .where(eq(userSchema.id, authUserId))
      .limit(1);

    if (existing) {
      // Check if profile needs display name initialization
      // (for users created before this feature)
      if (!existing.displayName || existing.displayName === '') {
        const displayName = deriveDisplayNameFromClerk(
          authUserId,
          options?.firstName,
          options?.lastName,
          options?.username,
        );

        const [updated] = await db
          .update(userSchema)
          .set({ displayName })
          .where(eq(userSchema.id, authUserId))
          .returning();

        if (updated) {
          logger.info({ userId: authUserId }, 'Updated existing user with display name');
          return mapDbUserToProfile(updated);
        }
      }

      return mapDbUserToProfile(existing);
    }

    // Profile doesn't exist - create it with retry logic for race conditions
    const displayName = deriveDisplayNameFromClerk(
      authUserId,
      options?.firstName,
      options?.lastName,
      options?.username,
    );

    const preferredLanguage = detectPreferredLanguage(
      options?.clerkLocale,
      options?.acceptLanguage,
    );

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Try to insert new profile
        const [created] = await db
          .insert(userSchema)
          .values({
            id: authUserId,
            displayName,
            preferredLanguage,
          })
          .onConflictDoNothing({ target: userSchema.id })
          .returning();

        if (created) {
          logger.info(
            { userId: authUserId, displayName, preferredLanguage },
            'Created new user profile',
          );
          return mapDbUserToProfile(created);
        }

        // If no result returned, it means the record already exists (conflict)
        // Fetch the existing record
        const [existingAfterConflict] = await db
          .select()
          .from(userSchema)
          .where(eq(userSchema.id, authUserId))
          .limit(1);

        if (existingAfterConflict) {
          logger.info({ userId: authUserId }, 'Profile already existed (race condition)');

          // Update displayName if empty
          if (!existingAfterConflict.displayName || existingAfterConflict.displayName === '') {
            const [updated] = await db
              .update(userSchema)
              .set({ displayName })
              .where(eq(userSchema.id, authUserId))
              .returning();

            if (updated) {
              return mapDbUserToProfile(updated);
            }
          }

          return mapDbUserToProfile(existingAfterConflict);
        }

        // Very rare: record doesn't exist but insert also didn't work
        // Retry after a small delay
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      } catch (error) {
        logger.error({ userId: authUserId, attempt, error }, 'Error creating profile, retrying');

        // On last attempt, throw the error
        if (attempt === MAX_RETRIES - 1) {
          throw error;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }

    // This should not be reached, but as a final fallback, try fetching one more time
    const [finalCheck] = await db
      .select()
      .from(userSchema)
      .where(eq(userSchema.id, authUserId))
      .limit(1);

    if (finalCheck) {
      return mapDbUserToProfile(finalCheck);
    }

    throw new Error(`Failed to create user profile after ${MAX_RETRIES} attempts`);
  }

  /**
   * Get a user profile by ID
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    const [user] = await db
      .select()
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (!user) {
      return null;
    }

    return mapDbUserToProfile(user);
  }

  /**
   * Update a user's profile
   */
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserProfile | null> {
    const updateData: Partial<typeof userSchema.$inferInsert> = {};

    if (input.displayName !== undefined) {
      updateData.displayName = sanitizeDisplayName(input.displayName);
    }

    if (input.preferredLanguage !== undefined) {
      if (SupportedLanguages.includes(input.preferredLanguage)) {
        updateData.preferredLanguage = input.preferredLanguage;
      }
    }

    if (input.themePreference !== undefined) {
      if (ThemePreferences.includes(input.themePreference)) {
        updateData.themePreference = input.themePreference;
      }
    }

    if (Object.keys(updateData).length === 0) {
      // Nothing to update, return current profile
      return this.getProfile(userId);
    }

    const [updated] = await db
      .update(userSchema)
      .set(updateData)
      .where(eq(userSchema.id, userId))
      .returning();

    if (!updated) {
      return null;
    }

    logger.info({ userId, ...updateData }, 'Updated user profile');

    return mapDbUserToProfile(updated);
  }

  /**
   * Get or create profile for the current authenticated user.
   * This is a convenience method for use in API routes and server components.
   */
  async getCurrentUserProfile(acceptLanguage?: string | null): Promise<UserProfile | null> {
    const user = await currentUser();

    if (!user) {
      return null;
    }

    return this.getOrCreateProfile(user.id, {
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      clerkLocale: user.publicMetadata?.locale as string | undefined,
      acceptLanguage,
    });
  }
}

export const userProfileService = new UserProfileService();
