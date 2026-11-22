/**
 * API parity harness for the Next.js → Go migration.
 *
 * Every scenario runs twice on an identically reset and seeded database: once
 * against the legacy Next server and once against the Go server. Responses
 * must match: status, content type, selected headers and the JSON body.
 *
 * Values that legitimately differ between two runs are normalised before the
 * comparison: UUIDs become <uuid#n> in order of first appearance, and
 * timestamps in exactly the toISOString format become <ts>. Anything in a
 * different format is left as is, so a formatting difference still fails.
 *
 * Usage: node --import tsx tests/parity/run.mts [scenario-name-filter]
 * Env: PARITY_NEXT_URL (default http://localhost:3001),
 *      PARITY_GO_URL (default http://localhost:3000), DATABASE_URL.
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import pg from 'pg';

export type Step = {
  name: string;
  method?: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** Response headers to compare besides content-type. */
  compareHeaders?: string[];
  /** Compare the body as text instead of JSON. */
  text?: boolean;
  /** Keys whose values depend on the clock: only their type is compared. */
  volatile?: string[];
};

export type Scenario = {
  name: string;
  /** npm scripts run after e2e:reset, default ['e2e:seed']. */
  seeds?: string[];
  /** SQL run after seeding. */
  sql?: string[];
  steps: Step[];
};

type Captured = { status: number; contentType: string | null; headers: Record<string, string | null>; body: unknown };

const NEXT = process.env.PARITY_NEXT_URL ?? 'http://localhost:3001';
const GO = process.env.PARITY_GO_URL ?? 'http://localhost:3000';

async function prepare(s: Scenario) {
  execSync('npm run e2e:reset --silent', { stdio: 'ignore' });
  for (const seed of s.seeds ?? ['e2e:seed']) {
    execSync(`npm run ${seed} --silent`, { stdio: 'ignore' });
  }
  if (s.sql?.length) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (const sql of s.sql) {
        await client.query(sql);
      }
    } finally {
      await client.end();
    }
  }
}

function resolveTemplates(value: string, ctx: Record<string, Captured>): string {
  return value.replace(/\{\{([\w-]+)\.([\w.[\]-]+)\}\}/g, (_, step: string, p: string) => {
    let cur: any = ctx[step];
    for (const seg of p.replace(/\[(\d+)\]/g, '.$1').split('.')) {
      cur = cur?.[seg];
    }
    return String(cur);
  });
}

async function runSteps(base: string, s: Scenario): Promise<Captured[]> {
  await prepare(s);
  const ctx: Record<string, Captured> = {};
  const out: Captured[] = [];
  for (const step of s.steps) {
    const url = base + resolveTemplates(step.path, ctx);
    const body = step.rawBody !== undefined
      ? step.rawBody
      : step.body === undefined ? undefined : resolveTemplates(JSON.stringify(step.body), ctx);
    const res = await fetch(url, {
      method: step.method ?? 'GET',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...step.headers },
      body,
      redirect: 'manual',
    });
    const raw = await res.text();
    let parsed: unknown = raw;
    if (!step.text) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { __nonJSON: raw.slice(0, 500) };
      }
    }
    const headers: Record<string, string | null> = {};
    for (const h of step.compareHeaders ?? []) {
      headers[h] = res.headers.get(h);
    }
    const c: Captured = { status: res.status, contentType: res.headers.get('content-type'), headers, body: parsed };
    ctx[step.name] = c;
    out.push(c);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function maskVolatile(v: unknown, keys: string[]): unknown {
  if (!keys.length) {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(x => maskVolatile(x, keys));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keys.includes(k) ? `<${typeof x}>` : maskVolatile(x, keys)]));
  }
  return v;
}

function normalise(v: unknown, ids: Map<string, string>): unknown {
  if (typeof v === 'string') {
    if (UUID.test(v)) {
      if (!ids.has(v)) {
        ids.set(v, `<uuid#${ids.size}>`);
      }
      return ids.get(v);
    }
    if (ISO.test(v)) {
      return '<ts>';
    }
    return v.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  }
  if (Array.isArray(v)) {
    return v.map(x => normalise(x, ids));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      // Serial ids differ between runs because sequences keep counting.
      if (typeof x === 'number' && Number.isInteger(x) && /^(?:id|.*Id)$/.test(k)) {
        const key = `int:${x}`;
        if (!ids.has(key)) {
          ids.set(key, `<id#${ids.size}>`);
        }
        return [k, ids.get(key)];
      }
      return [k, normalise(x, ids)];
    }));
  }
  return v;
}

function keyOrder(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(keyOrder);
  }
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => [k, keyOrder(x)]);
  }
  return null;
}

async function main() {
  const filter = process.argv[2];
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'scenarios');
  let failures = 0;
  let total = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.mts')).sort()) {
    const mod = await import(path.join(dir, file));
    for (const s of mod.default as Scenario[]) {
      if (filter && !s.name.includes(filter) && !file.includes(filter)) {
        continue;
      }
      total++;
      const legacy = await runSteps(NEXT, s);
      const next = await runSteps(GO, s);
      const problems: string[] = [];
      s.steps.forEach((step, i) => {
        const a = legacy[i]!;
        const b = next[i]!;
        const ida = new Map<string, string>();
        const idb = new Map<string, string>();
        const vol = step.volatile ?? [];
        const na = { status: a.status, contentType: a.contentType, headers: a.headers, body: normalise(maskVolatile(a.body, vol), ida) };
        const nb = { status: b.status, contentType: b.contentType, headers: b.headers, body: normalise(maskVolatile(b.body, vol), idb) };
        if (!isDeepStrictEqual(na, nb)) {
          problems.push(`  step ${step.name}:\n    next: ${JSON.stringify(na).slice(0, 2000)}\n    go:   ${JSON.stringify(nb).slice(0, 2000)}`);
        } else if (!isDeepStrictEqual(keyOrder(a.body), keyOrder(b.body))) {
          problems.push(`  step ${step.name}: same values, different key order\n    next: ${JSON.stringify(keyOrder(a.body)).slice(0, 800)}\n    go:   ${JSON.stringify(keyOrder(b.body)).slice(0, 800)}`);
        }
      });
      if (problems.length) {
        failures++;
        console.warn(`✘ ${file} › ${s.name}\n${problems.join('\n')}`);
      } else {
        console.warn(`✓ ${file} › ${s.name} (${s.steps.length} steps)`);
      }
    }
  }
  console.warn(`\n${total - failures}/${total} scenarios identical`);
  process.exit(failures ? 1 : 0);
}

await main();
