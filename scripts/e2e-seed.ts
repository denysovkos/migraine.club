/**
 * Idempotent seed for the Playwright e2e mock user.
 *
 * Inserts the minimum rows needed for the signed-in dashboard to render.
 * Safe to re-run: existing rows are upserted, not duplicated.
 *
 * Run: npm run e2e:seed (DATABASE_URL must be set)
 */

import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { DateTime } from 'luxon';
import { Pool } from 'pg';

import * as schema from '../src/models/Schema';

const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const db = drizzlePg(pool, { schema, logger: false });

async function seed() {
  console.log(`[e2e-seed] Seeding for user ${E2E_USER_ID}`);

  // 1. user row (upsert)
  await db
    .insert(schema.userSchema)
    .values({
      id: E2E_USER_ID,
      displayName: 'E2E User',
      preferredLanguage: 'en',
      themePreference: 'light',
    })
    .onConflictDoUpdate({
      target: schema.userSchema.id,
      set: { displayName: 'E2E User' },
    });

  // 2. health-data + terms + privacy consents
  // (HealthDataConsentGuard requires all three: see useHealthDataConsent.ts).
  for (const consentType of ['health_data', 'terms', 'privacy'] as const) {
    await db
      .insert(schema.userConsentSchema)
      .values({
        userId: E2E_USER_ID,
        consentType,
        version: '1.0',
      })
      .onConflictDoNothing();
  }

  // 3. outcome settings (timezone)
  await db
    .insert(schema.userOutcomeSettingsSchema)
    .values({
      userId: E2E_USER_ID,
      timezone: 'Europe/Kyiv',
      preferredWindowDays: 28,
    })
    .onConflictDoUpdate({
      target: schema.userOutcomeSettingsSchema.userId,
      set: { timezone: 'Europe/Kyiv' },
    });

  // 4. weather settings (location for WPI card)
  await db
    .insert(schema.userWeatherSettingsSchema)
    .values({
      userId: E2E_USER_ID,
      lat: 50.45,
      lon: 30.52,
      locationLabel: 'Kyiv',
      timezone: 'Europe/Kyiv',
      units: 'metric',
    })
    .onConflictDoNothing();

  // 4b. pressure forecast for the seeded location, so the outlook card never
  // calls OpenWeatherMap. Fresh fetchedAt keeps it inside the cache TTL.
  // Day-over-day: today, -2, -7 (drop), +3, -1, -7 (drop).
  const kyivToday = DateTime.now().setZone('Europe/Kyiv').startOf('day').plus({ hours: 12 });
  const pressurePoints = [1018, 1016, 1009, 1012, 1011, 1004].map((pressureHpa, i) => ({
    dt: Math.floor(kyivToday.plus({ days: i }).toSeconds()),
    pressureHpa,
  }));
  await db
    .insert(schema.pressureForecastCacheSchema)
    .values({ lat: 50.45, lon: 30.52, points: pressurePoints, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.pressureForecastCacheSchema.lat, schema.pressureForecastCacheSchema.lon],
      set: { points: pressurePoints, fetchedAt: new Date() },
    });

  // 5. a couple of past diary entries for the streak strip
  const today = new Date();
  const days: Array<{ daysAgo: number; dayType: schema.DiaryDayTypeType }> = [
    { daysAgo: 1, dayType: schema.DiaryDayType.HEADACHE_FREE },
    { daysAgo: 2, dayType: schema.DiaryDayType.HEADACHE_DAY },
    { daysAgo: 3, dayType: schema.DiaryDayType.HEADACHE_FREE },
  ];
  for (const { daysAgo, dayType } of days) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    // Strip the time portion so the unique index on (userId, localDate) works
    const localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    await db
      .insert(schema.dailyDiaryEntrySchema)
      .values({
        userId: E2E_USER_ID,
        localDate,
        timezone: 'Europe/Kyiv',
        dayType,
        createdFrom: 'user',
      })
      .onConflictDoNothing();
  }

  // 6. one active preventive plan so the Preventives card has a row to log against
  const existingPlans = await db
    .select({ id: schema.preventivePlanSchema.id })
    .from(schema.preventivePlanSchema)
    .where(eq(schema.preventivePlanSchema.userId, E2E_USER_ID));
  if (existingPlans.length === 0) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    await db.insert(schema.preventivePlanSchema).values({
      userId: E2E_USER_ID,
      name: 'Topiramate (E2E)',
      kind: 'oral',
      doseText: '50 mg morning',
      scheduleType: 'daily',
      schedulePayload: { times: ['08:00'] },
      startDate,
      status: 'active',
    });
  }

  // 7a. program settings — module must be enabled for the dashboard cards
  // (SleepRegularityCard / AcuteMedTimingCard) to render anything.
  await db
    .insert(schema.programSettingsSchema)
    .values({
      userId: E2E_USER_ID,
      enabled: true,
      notificationsConfig: {},
    })
    .onConflictDoUpdate({
      target: schema.programSettingsSchema.userId,
      set: { enabled: true },
    });

  // 7b. program enrollments: sleep regularity + acute med timing
  const existingEnrollments = await db
    .select({ id: schema.programEnrollmentSchema.id })
    .from(schema.programEnrollmentSchema)
    .where(eq(schema.programEnrollmentSchema.userId, E2E_USER_ID));
  if (existingEnrollments.length === 0) {
    const startStr = isoDate(daysAgo(7));
    const baseStart = isoDate(daysAgo(28));
    const baseEnd = isoDate(daysAgo(8));
    const evalStart = isoDate(daysAgo(7));
    const evalEnd = isoDate(daysAhead(21));

    await db.insert(schema.programEnrollmentSchema).values({
      userId: E2E_USER_ID,
      programId: 'sleep-regularity',
      status: 'active',
      targetPayload: {
        bedTime: '23:00',
        wakeTime: '07:00',
        toleranceMinutes: 30,
      },
      startDate: startStr,
      baselineWindowStart: baseStart,
      baselineWindowEnd: baseEnd,
      evaluationWindowStart: evalStart,
      evaluationWindowEnd: evalEnd,
      rampDays: 14,
      timezone: 'Europe/Kyiv',
    });

    await db.insert(schema.programEnrollmentSchema).values({
      userId: E2E_USER_ID,
      programId: 'acute-med-timing',
      status: 'active',
      targetPayload: { withinMinutes: 30 },
      startDate: startStr,
      baselineWindowStart: baseStart,
      baselineWindowEnd: baseEnd,
      evaluationWindowStart: evalStart,
      evaluationWindowEnd: evalEnd,
      rampDays: 14,
      timezone: 'Europe/Kyiv',
    });
  }

  // 8. intake response — this fixture's user represents an already-onboarded
  // account (it already has meds, a preventive plan, program enrollments,
  // etc.), not the brand-new user the F43 baseline-intake gate targets.
  // Mark intake 'skipped', the same status the F43 migration backfills onto
  // every pre-existing user, so IntakeGate doesn't redirect these
  // dashboard-focused specs into the onboarding wizard.
  await db
    .insert(schema.intakeResponseSchema)
    .values({
      userId: E2E_USER_ID,
      status: 'skipped',
    })
    .onConflictDoUpdate({
      target: schema.intakeResponseSchema.userId,
      set: { status: 'skipped' },
    });

  console.log('[e2e-seed] Done');
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysAhead(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-seed] FAILED', err);
    await pool.end();
    process.exit(1);
  });
