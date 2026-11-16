import path from 'node:path';

import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import * as schema from '@/models/Schema';

import { Env } from './Env';
import { logger } from './Logger';

const pool = new Pool({
  connectionString: Env.DATABASE_URL,
  // Cron jobs and user requests share this pool; too small and a long cron starves the web app.
  max: Env.DATABASE_POOL_MAX ?? 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Cap how long a single query may block a request. This has to be `query_timeout`
  // (a client-side timer) rather than `statement_timeout`/`options`: pg sends those
  // in the startup packet, and a pooled Neon connection rejects startup parameters
  // with "unsupported startup parameter in options".
  // Trade-off: this stops us waiting, but does not cancel the query server-side.
  query_timeout: 30_000,
});

// Logging every statement floods stdout during cron loops over thousands of users,
// and a blocked stdout on Render blocks the event loop.
const drizzle = drizzlePg(pool, { schema, logger: process.env.NODE_ENV === 'development' });

/**
 * Arbitrary but stable key identifying the migration lock. Any value works as
 * long as every instance agrees on it.
 */
const MIGRATION_LOCK_KEY = 4_827_301_955;

/**
 * Apply pending migrations.
 *
 * Deliberately NOT run at import time. Doing so made every process that touched
 * `db` migrate on startup — including each of Next's build workers, which then
 * raced each other and failed the build with
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
 * as two workers ran the same CREATE TABLE concurrently. This is called once
 * from `src/instrumentation.ts`, which Next skips during builds and invokes
 * exactly once per server process.
 *
 * The advisory lock serialises instances that boot at the same time (a rolling
 * deploy), so only one applies the migrations and the others wait and no-op.
 */
export async function runMigrations(): Promise<void> {
  // Modules import `db` even when they only need pure helpers; connecting would
  // break unit tests without a real database.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }

  if (Env.RUN_MIGRATIONS_ON_BOOT === 'false') {
    logger.info('RUN_MIGRATIONS_ON_BOOT=false; skipping startup migrations');
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await migratePg(drizzle, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });

    logger.info('Database migrations applied');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

export const db = drizzle;
