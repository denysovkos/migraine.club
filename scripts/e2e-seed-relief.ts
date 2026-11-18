/**
 * Extra rows for the relief tools e2e spec, on top of scripts/e2e-seed.ts.
 *
 * Another user gets an attack and a relief session linked to it. The e2e user
 * must never see that session, nor be able to link a session of their own to
 * that attack. The e2e user's own sessions are created through the UI.
 *
 * Idempotent: the e2e user's rows are wiped by e2e-reset.ts before each test,
 * and the other user's rows are replaced here.
 *
 * Run: npm run e2e:seed:relief (DATABASE_URL must be set)
 */

import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/models/Schema';

const RELIEF_OTHER_USER_ID = 'e2e_relief_other_user';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const db = drizzlePg(pool, { schema, logger: false });

const HOUR = 60 * 60 * 1000;

async function seed() {
  console.log('[e2e-seed-relief] Seeding another user\'s relief session');

  await db.delete(schema.reliefSessionSchema).where(eq(schema.reliefSessionSchema.userId, RELIEF_OTHER_USER_ID));
  await db.delete(schema.episodeSchema).where(eq(schema.episodeSchema.userId, RELIEF_OTHER_USER_ID));

  const startTime = new Date(Date.now() - 3 * HOUR);
  const [attack] = await db
    .insert(schema.episodeSchema)
    .values({
      userId: RELIEF_OTHER_USER_ID,
      startTime,
      endTime: new Date(Date.now() - HOUR),
      isOngoing: false,
      attackType: 'migraine',
      intensity: 4,
      painLocation: 'other',
      painType: 'other',
      notes: 'ReliefOtherUserAttack',
    })
    .returning({ id: schema.episodeSchema.id });

  await db.insert(schema.reliefSessionSchema).values({
    userId: RELIEF_OTHER_USER_ID,
    episodeId: attack!.id,
    exercise: 'relaxation',
    startedAt: new Date(startTime.getTime() + 30 * 60 * 1000),
    durationSeconds: 220,
    completed: true,
    helped: 'yes',
  });

  console.log('[e2e-seed-relief] Done');
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[e2e-seed-relief] FAILED', err);
    await pool.end();
    process.exit(1);
  });
