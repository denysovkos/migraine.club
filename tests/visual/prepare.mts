// Resets the e2e database, seeds it and adds the visual fixtures, so every
// capture starts from the same rows.
// Usage: node --import tsx tests/visual/prepare.mts
import { execSync } from 'node:child_process';
import process from 'node:process';

import pg from 'pg';

import { FIXTURES } from './routes';

execSync('npm run e2e:reset && npm run e2e:seed', { stdio: 'ignore' });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const statement of FIXTURES) {
  await client.query(statement);
}
await client.end();
