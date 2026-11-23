/**
 * Records the <head> metadata tags a server sends for every route (no
 * scripts, styles or bundle preloads): the reference the SPA's head
 * rendering is checked against.
 *
 * Usage: node --import tsx tests/visual/heads.mts <baseURL> <out.json>
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { headTags } from './headTags';
import { routes } from './routes';

async function main() {
  const [base, out] = process.argv.slice(2);
  if (!base || !out) {
    throw new Error('usage: heads.mts <baseURL> <out.json>');
  }
  const result: Record<string, { status: number; tags: string[] }> = {};
  for (const route of routes()) {
    const res = await fetch(base + route, { redirect: 'manual' });
    result[route] = { status: res.status, tags: headTags(await res.text()) };
  }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
}

await main();
