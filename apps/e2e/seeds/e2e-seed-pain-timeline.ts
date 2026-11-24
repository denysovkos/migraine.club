/**
 * Extra rows for the pain timeline e2e spec, on top of scripts/e2e-seed.ts.
 *
 * - The e2e user gets an attack that ended this morning after running past
 *   two midnights (a multi-day attack), with no pain readings yet.
 * - A second user gets an attack with a pain reading of their own. The e2e
 *   user must never see or change either.
 *
 * Idempotent: the e2e user's rows are wiped by e2e-reset.ts before each test,
 * and the other user's rows are replaced here.
 *
 * Run: npm run e2e:seed:pain-timeline (DATABASE_URL must be set)
 */

import * as schema from '@migraine/db/schema';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';

import { Pool } from 'pg';

const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';
const PAIN_TIMELINE_OTHER_USER_ID = 'e2e_pain_timeline_other_user';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const db = drizzlePg(pool, { schema, logger: false });

const HOUR = 60 * 60 * 1000;

async function seed() {
  console.log(`[e2e-seed-pain-timeline] Seeding a multi-day attack for ${E2E_USER_ID}`);

  const end = new Date(Date.now() - 2 * HOUR);
  await db.insert(schema.episodeSchema).values({
    userId: E2E_USER_ID,
    startTime: new Date(end.getTime() - 50 * HOUR),
    endTime: end,
    isOngoing: false,
    attackType: 'migraine',
    intensity: 3,
    painLocation: 'left_side',
    painType: 'throbbing',
    notes: 'PainTimelineSeedAttack',
  });

  for (const table of [schema.episodePainReadingSchema, schema.episodeSchema]) {
    await db.delete(table).where(eq(table.userId, PAIN_TIMELINE_OTHER_USER_ID));
  }
  const [other] = await db
    .insert(schema.episodeSchema)
    .values({
      userId: PAIN_TIMELINE_OTHER_USER_ID,
      startTime: new Date(Date.now() - 5 * HOUR),
      endTime: new Date(Date.now() - 1 * HOUR),
      isOngoing: false,
      attackType: 'migraine',
      intensity: 5,
      painLocation: 'other',
      painType: 'other',
    })
    .returning({ id: schema.episodeSchema.id });
  await db.insert(schema.episodePainReadingSchema).values({
    userId: PAIN_TIMELINE_OTHER_USER_ID,
    episodeId: other!.id,
    recordedAt: new Date(Date.now() - 4 * HOUR),
    intensity: 5,
  });

  console.log('[e2e-seed-pain-timeline] Done');
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-seed-pain-timeline] FAILED', err);
    await pool.end();
    process.exit(1);
  });
