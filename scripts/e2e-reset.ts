/**
 * Idempotent reset for the Playwright e2e mock user.
 *
 * Deletes ALL rows belonging to E2E_MOCK_USER_ID across every userId-keyed
 * table. Safe to re-run between tests.
 *
 * Run: npm run e2e:reset (DATABASE_URL must be set)
 */

import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/models/Schema';

const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

const db = drizzlePg(pool, { schema, logger: false });

async function reset() {
  console.log(`[e2e-reset] Wiping rows for ${E2E_USER_ID}`);

  // Order matters where foreign keys cascade, but we wipe everything
  // that has a `userId` column on the user we control.
  const tablesWithUserId = [
    schema.programAdherenceEventSchema,
    schema.programRecommendationDismissalSchema,
    schema.programEnrollmentSchema,
    schema.programSettingsSchema,
    schema.intakeResponseSchema,
    schema.preventiveStatusChangeSchema,
    schema.preventiveWeeklyCheckInSchema,
    schema.preventiveIntakeEventSchema,
    schema.preventivePlanSchema,
    schema.dailyDiaryEntrySchema,
    schema.cycleBleedingDaySchema,
    schema.cycleSettingsSchema,
    schema.pushSubscriptionSchema,
    schema.userConsentSchema,
    schema.userOutcomeSettingsSchema,
    schema.userWeatherSettingsSchema,
    schema.userMedicationsSchema,
    schema.medicationIntakesSchema,
    schema.acuteDosesSchema,
    schema.doseOutcomesSchema,
    schema.factorEventSchema,
    schema.factorSchema,
    schema.episodeSchema,
    schema.questionnaireResponseSchema,
    schema.featureRequestSchema,
    schema.appointmentPrepSchema,
    schema.doctorShareLinkSchema,
    schema.riskAlertRunSchema,
    schema.insightsCacheSchema,
    schema.insightTestPlanSchema,
    schema.communityVoteSchema,
    schema.communityReportSchema,
    schema.communityCommentSchema,
    schema.communityPostSchema,
    schema.doctorVerificationApplicationSchema,
  ];

  for (const table of tablesWithUserId) {
    if (!table || typeof table !== 'object') {
      continue;
    }
    const userIdCol = (table as any).userId;
    if (!userIdCol) {
      continue;
    }
    const tableName = (table as any)?._?.name ?? '<unknown>';
    try {
      await db.delete(table).where(eq(userIdCol, E2E_USER_ID));
    } catch (err) {
      console.warn(
        `[e2e-reset] Skipping ${tableName}: ${(err as Error).message}`,
      );
    }
  }

  // user row last (other tables may FK-reference it implicitly via id matching).
  await db.delete(schema.userSchema).where(eq(schema.userSchema.id, E2E_USER_ID));

  console.log('[e2e-reset] Done');
}

reset()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-reset] FAILED', err);
    await pool.end();
    process.exit(1);
  });
