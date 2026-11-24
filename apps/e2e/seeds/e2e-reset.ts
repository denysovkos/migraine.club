/**
 * Idempotent reset for the Playwright e2e mock user.
 *
 * Deletes ALL rows belonging to E2E_MOCK_USER_ID across every user-owned
 * table (RESET_TABLES). Safe to re-run between tests.
 *
 * Run: npm run e2e:reset (DATABASE_URL must be set)
 */

import * as schema from '@migraine/db/schema';
import { eq, getTableName } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';

import { Pool } from 'pg';
import { RESET_TABLES } from './e2eResetTables';

const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

const db = drizzlePg(pool, { schema, logger: false });

async function reset() {
  console.log(`[e2e-reset] Wiping rows for ${E2E_USER_ID}`);

  for (const { table, owner } of RESET_TABLES) {
    try {
      await db.delete(table).where(eq(owner, E2E_USER_ID));
    } catch (err) {
      console.warn(`[e2e-reset] Skipping ${getTableName(table)}: ${(err as Error).message}`);
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
