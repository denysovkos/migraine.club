import { auth } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { userWeatherSettingsSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

/**
 * Check if the alerts_enabled column exists in the database
 * This handles the case where the migration hasn't been run yet
 */
async function checkAlertsColumnExists(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_weather_settings' 
      AND column_name = 'alerts_enabled'
    `);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * GET /api/user/alerts - Get user's alert settings
 */
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Check if the alerts column exists (migration may not have been run)
    const columnExists = await checkAlertsColumnExists();

    if (!columnExists) {
      logger.warn('alerts_enabled column does not exist - migration pending');
      // Return default values if migration hasn't been run
      const [settings] = await db
        .select({
          timezone: userWeatherSettingsSchema.timezone,
          hasLocation: userWeatherSettingsSchema.lat,
        })
        .from(userWeatherSettingsSchema)
        .where(eq(userWeatherSettingsSchema.userId, userId))
        .limit(1);

      return NextResponse.json({
        alertsEnabled: false,
        hasLocation: settings?.hasLocation !== null && settings?.hasLocation !== undefined,
        timezone: settings?.timezone ?? null,
        migrationPending: true,
      });
    }

    const [settings] = await db
      .select({
        alertsEnabled: userWeatherSettingsSchema.alertsEnabled,
        timezone: userWeatherSettingsSchema.timezone,
        hasLocation: userWeatherSettingsSchema.lat,
      })
      .from(userWeatherSettingsSchema)
      .where(eq(userWeatherSettingsSchema.userId, userId))
      .limit(1);

    if (!settings) {
      return NextResponse.json({
        alertsEnabled: false,
        hasLocation: false,
        timezone: null,
      });
    }

    return NextResponse.json({
      alertsEnabled: settings.alertsEnabled,
      hasLocation: settings.hasLocation !== null,
      timezone: settings.timezone,
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching alert settings');
    return NextResponse.json(
      { error: 'Failed to fetch alert settings' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/user/alerts - Update user's alert settings
 */
const updateAlertsSchema = z.object({
  alertsEnabled: z.boolean(),
});

export async function PUT(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Check if the alerts column exists (migration may not have been run)
    const columnExists = await checkAlertsColumnExists();

    if (!columnExists) {
      logger.warn('alerts_enabled column does not exist - migration pending');
      return NextResponse.json(
        { error: 'Daily risk alerts feature is not yet available. Database migration pending.' },
        { status: 503 },
      );
    }

    const body = await request.json();
    const result = updateAlertsSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: result.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { alertsEnabled } = result.data;

    // Check if user has weather settings (required for alerts)
    const [settings] = await db
      .select({ id: userWeatherSettingsSchema.id })
      .from(userWeatherSettingsSchema)
      .where(eq(userWeatherSettingsSchema.userId, userId))
      .limit(1);

    if (!settings) {
      return NextResponse.json(
        { error: 'Location not configured. Please set up your location first.' },
        { status: 400 },
      );
    }

    // Update alerts setting
    await db
      .update(userWeatherSettingsSchema)
      .set({ alertsEnabled })
      .where(eq(userWeatherSettingsSchema.userId, userId));

    logger.info({ userId, alertsEnabled }, 'Updated user alert settings');

    return NextResponse.json({
      ok: true,
      alertsEnabled,
    });
  } catch (error) {
    logger.error({ error }, 'Error updating alert settings');
    return NextResponse.json(
      { error: 'Failed to update alert settings' },
      { status: 500 },
    );
  }
}
