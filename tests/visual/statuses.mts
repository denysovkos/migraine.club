/**
 * Compares what two servers answer at the HTTP level, without following
 * redirects: status, Location, Set-Cookie, Link, Allow, Content-Type, Vary
 * and Content-Encoding, for every visual route and the URL / method edge
 * cases Next handled itself, each with no locale hints, a NEXT_LOCALE
 * cookie and an Accept-Language header.
 *
 * Usage: node --import tsx tests/visual/statuses.mts <expectedBase> <actualBase>
 *
 * Three things Next sent are left out on both sides, on purpose (see
 * docs/migration/STATUS.md): Link preload hints for Next's own build files,
 * the HTML body Next wrote with a page's 3xx (its type, encoding and the
 * Vary: Accept-Encoding that came with it), and /monitoring without the
 * tunnel's parameters (Next rendered the landing page there, a bug).
 */
import process from 'node:process';

import { routes } from './routes';

const EDGES: [string, string][] = [
  ['GET', '/dashboard/'],
  ['GET', '/fr/'],
  ['GET', '//dashboard?x=1'],
  ['GET', '/dashboard//'],
  ['GET', '/help/ai-connector?x=1'],
  ['GET', '/uk/help/ai-connector'],
  ['GET', '/api/episodes/'],
  ['GET', '/api/nope'],
  ['POST', '/dashboard'],
  ['PUT', '/fr/reports'],
  ['OPTIONS', '/dashboard'],
  ['OPTIONS', '/no-such-page'],
  ['PUT', '/robots.txt'],
  ['HEAD', '/robots.txt'],
  ['HEAD', '/api/episodes'],
  ['OPTIONS', '/api/user/profile'],
  ['PUT', '/api/episodes'],
  ['GET', '/sitemap.xml'],
  ['GET', '/manifest.webmanifest'],
];

const VARIANTS: Record<string, Record<string, string>> = {
  plain: {},
  cookieFr: { cookie: 'NEXT_LOCALE=fr' },
  acceptUk: { 'accept-language': 'uk-UA,uk;q=0.9' },
};

const HEADERS = ['location', 'set-cookie', 'link', 'allow', 'content-type', 'vary', 'content-encoding'];

async function probe(base: string, method: string, path: string, headers: Record<string, string>) {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'accept-encoding': 'gzip', ...headers } });
  await res.arrayBuffer();
  const out: Record<string, string | number> = { status: res.status };
  for (const h of HEADERS) {
    const v = h === 'set-cookie' ? res.headers.getSetCookie().map(c => c.split(';')[0]).join(' | ') : res.headers.get(h);
    if (v) {
      // Absolute URLs carry each server's own origin.
      out[h] = v.replaceAll(base, '<origin>').toLowerCase().replace(/;\s*charset=utf-8/, '').replace(/\s+/g, ' ');
    }
  }
  return normalise(out);
}

function normalise(out: Record<string, string | number>): Record<string, string | number> {
  if (typeof out.link === 'string') {
    out.link = out.link.split(/,\s*(?=<)/).filter(l => !/^<\/_next\/.*rel=preload/.test(l)).join(', ');
    if (!out.link) {
      delete out.link;
    }
  }
  if (Number(out.status) >= 300 && Number(out.status) < 400) {
    delete out['content-type'];
    delete out['content-encoding'];
    if (typeof out.vary === 'string') {
      out.vary = out.vary.replace(/,\s*accept-encoding$/, '');
    }
  }
  return out;
}

async function main() {
  const [expected, actual] = process.argv.slice(2);
  if (!expected || !actual) {
    throw new Error('usage: statuses.mts <expectedBase> <actualBase>');
  }
  const cases: [string, string][] = [...routes().map(r => ['GET', r] as [string, string]), ...EDGES];
  let failures = 0;
  let total = 0;
  for (const [method, path] of cases) {
    for (const [variant, headers] of Object.entries(VARIANTS)) {
      total++;
      const [a, b] = await Promise.all([probe(expected, method, path, headers), probe(actual, method, path, headers)]);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        failures++;
        console.warn(`✘ ${method} ${path} [${variant}]\n    expected ${JSON.stringify(a)}\n    actual   ${JSON.stringify(b)}`);
      }
    }
  }
  console.warn(`${total - failures}/${total} identical`);
  process.exit(failures ? 1 : 0);
}

await main();
