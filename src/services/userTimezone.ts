import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { userOutcomeSettingsSchema, userWeatherSettingsSchema } from '@/models/Schema';

/**
 * Feature F37: single source of truth for the user's timezone.
 *
 * Precedence:
 * 1) user_outcome_settings.timezone (if set)
 * 2) user_weather_settings.timezone
 * 3) 'UTC'
 *
 * IMPORTANT: Do not use server timezone.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  const [settings] = await db
    .select({ tz1: userOutcomeSettingsSchema.timezone })
    .from(userOutcomeSettingsSchema)
    .where(eq(userOutcomeSettingsSchema.userId, userId))
    .limit(1);

  if (settings?.tz1) {
    return settings.tz1;
  }

  const [weather] = await db
    .select({ tz2: userWeatherSettingsSchema.timezone })
    .from(userWeatherSettingsSchema)
    .where(eq(userWeatherSettingsSchema.userId, userId))
    .limit(1);

  return weather?.tz2 ?? 'UTC';
}
