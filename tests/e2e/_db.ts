/**
 * Direct database access for e2e specs that need to arrange rows the UI can't
 * create, or assert on what actually landed in Postgres.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

export const E2E_USER_ID = process.env.E2E_MOCK_USER_ID || 'e2e_user_test_001';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // The seed scripts read .env through dotenv; do the same here.
  const line = readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('DATABASE_URL='));
  return line!.slice('DATABASE_URL='.length).trim();
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}
