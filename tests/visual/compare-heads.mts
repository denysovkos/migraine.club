/**
 * Checks web/dist/heads.json (web/scripts/prerender.mts) against the head
 * tags a Next server sent (tests/visual/heads.mts), route by route.
 *
 * Usage: node --import tsx tests/visual/compare-heads.mts <next-heads.json> [web/dist/heads.json]
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import { headTags } from './headTags';

const LOCALES = ['fr', 'uk'];

/** The page pattern a concrete path renders, preferring static segments. */
export function matchPattern(patterns: string[], pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean);
  const score = (pattern: string): number | null => {
    const segs = pattern.split('/').filter(Boolean);
    let s = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      if (seg === '*?' || seg === '*') {
        return seg === '*' && parts.length <= i ? null : s;
      }
      if (i >= parts.length) {
        return null;
      }
      if (seg.startsWith(':')) {
        s += 1;
      } else if (seg === parts[i]) {
        s += 2;
      } else {
        return null;
      }
    }
    return segs.length === parts.length ? s : null;
  };
  let best: string | undefined;
  let bestScore = -1;
  for (const p of patterns) {
    const s = score(p);
    if (s !== null && s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

function main() {
  const [nextFile, headsFile = 'web/dist/heads.json'] = process.argv.slice(2);
  const next = JSON.parse(readFileSync(nextFile!, 'utf8')) as Record<string, { status: number; tags: string[] }>;
  const heads = JSON.parse(readFileSync(headsFile, 'utf8')) as Record<string, Record<string, string>>;
  const patterns = Object.keys(heads);
  let failures = 0;
  let checked = 0;
  for (const [route, captured] of Object.entries(next)) {
    if (captured.status !== 200) {
      continue;
    }
    const first = route.split('/')[1] ?? '';
    const locale = LOCALES.includes(first) ? first : 'en';
    const path = locale === 'en' ? route : route.slice(locale.length + 1) || '/';
    const pattern = matchPattern(patterns, path);
    const html = pattern ? heads[pattern]?.[locale] : undefined;
    checked++;
    const tags = html === undefined ? null : headTags(`<head>${html}</head>`);
    if (!isDeepStrictEqual(tags, captured.tags)) {
      failures++;
      const missing = captured.tags.filter(t => !tags?.includes(t));
      const extra = (tags ?? []).filter(t => !captured.tags.includes(t));
      console.warn(`✘ ${route} (${pattern ?? 'no pattern'})\n    missing: ${missing.join('\n             ')}\n    extra:   ${extra.join('\n             ')}`);
    }
  }
  console.warn(`${checked - failures}/${checked} heads identical`);
  process.exit(failures ? 1 : 0);
}

main();
