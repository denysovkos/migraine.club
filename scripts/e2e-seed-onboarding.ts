/**
 * Idempotent seed for the F43 baseline-intake activation e2e spec.
 *
 * Deliberately minimal: a brand-new user who has consented to health data
 * processing (so the wizard's medication search and the consent guard don't
 * get in the way) and has the programs module enabled (so a recommendation
 * can actually surface once intake completes) — but has NO `intake_response`
 * row, no medications, no preventive plan and no program enrollments. That
 * absence is the whole point: it's what makes the dashboard gate redirect to
 * /onboarding, and what lets `rankRecommendations` suggest a program instead
 * of skipping it as "already enrolled".
 *
 * Run: npm run e2e:seed:onboarding (DATABASE_URL must be set)
 */

import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
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
  console.log(`[e2e-seed-onboarding] Seeding brand-new user ${E2E_USER_ID}`);

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
  // Both /dashboard and /onboarding are wrapped in this guard, so a brand-new
  // user still needs these to reach the intake wizard at all.
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

  // 3. programs module enabled — ProgramSuggestionTile checks this before it
  // will even call /api/programs/recommendations.
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

  // 4. minimal medication catalogue. The full catalogue (`npm run db:seed`)
  // pulls from external drug registries, which is too slow and flaky for CI.
  // Include near-misses so the spec still proves it picks the exact match.
  for (const canonicalName of ['Ibuprofen', 'Ibuprofen, combinations', 'Dexibuprofen', 'Sumatriptan']) {
    await db
      .insert(schema.medicationsCatalogSchema)
      .values({
        canonicalName,
        canonicalNameLc: canonicalName.toLowerCase(),
        searchText: canonicalName,
      })
      .onConflictDoNothing();
  }

  console.log('[e2e-seed-onboarding] Done');
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-seed-onboarding] FAILED', err);
    await pool.end();
    process.exit(1);
  });
