/**
 * Extra rows for the attack mode e2e spec, on top of scripts/e2e-seed.ts.
 *
 * - The e2e user gets two acute medications with recent intakes, so the
 *   "Took medication" step has one-tap suggestions (Sumatriptan used most).
 * - A second user gets an ongoing attack and a medication of their own. Attack
 *   mode must never show either of them to the e2e user.
 *
 * Idempotent: the e2e user's rows are wiped by e2e-reset.ts before each test,
 * and the other user's rows are replaced here.
 *
 * Run: npm run e2e:seed:attack-mode (DATABASE_URL must be set)
 */

import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/models/Schema';

const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';
const ATTACK_MODE_OTHER_USER_ID = 'e2e_attack_mode_other_user';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const db = drizzlePg(pool, { schema, logger: false });

const DAY = 24 * 60 * 60 * 1000;

async function addMedication(userId: string, name: string, dose: string, unit: string, intakesDaysAgo: number[]) {
  const [med] = await db
    .insert(schema.userMedicationsSchema)
    .values({ userId, customName: name, defaultDose: dose, defaultUnit: unit, isAcute: true })
    .returning({ id: schema.userMedicationsSchema.id });
  for (const daysAgo of intakesDaysAgo) {
    await db.insert(schema.medicationIntakesSchema).values({
      userId,
      userMedicationId: med!.id,
      takenAt: new Date(Date.now() - daysAgo * DAY),
      dose,
      unit,
    });
  }
}

async function seed() {
  console.log(`[e2e-seed-attack-mode] Seeding medications for ${E2E_USER_ID}`);

  await addMedication(E2E_USER_ID, 'Sumatriptan', '50', 'mg', [3, 10, 20]);
  await addMedication(E2E_USER_ID, 'Ibuprofen', '400', 'mg', [5]);

  for (const table of [schema.medicationIntakesSchema, schema.userMedicationsSchema, schema.episodeSchema]) {
    await db.delete(table).where(eq(table.userId, ATTACK_MODE_OTHER_USER_ID));
  }

  await addMedication(ATTACK_MODE_OTHER_USER_ID, 'OtherUserOnlyMed', '1', 'tablet', [1, 2, 4, 6]);
  await db.insert(schema.episodeSchema).values({
    userId: ATTACK_MODE_OTHER_USER_ID,
    startTime: new Date(Date.now() - 60 * 60 * 1000),
    isOngoing: true,
    attackType: 'migraine',
    intensity: 5,
    painLocation: 'other',
    painType: 'other',
  });

  console.log('[e2e-seed-attack-mode] Done');
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-seed-attack-mode] FAILED', err);
    await pool.end();
    process.exit(1);
  });
