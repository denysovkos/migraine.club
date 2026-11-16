import fs from 'node:fs/promises';
import path from 'node:path';

type SeedEntry = {
  name: string;
  sources: string[];
  atcPrefixes?: string[];
  type: 'brand' | 'generic' | 'ingredient';
};

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  const skipUs = flags.has('--skip-us');
  const skipCa = flags.has('--skip-ca');
  const skipUa = flags.has('--skip-ua');
  return { skipUs, skipCa, skipUa };
}

function ensureAtMost1000(entries: SeedEntry[]): SeedEntry[] {
  const scored = entries.map((e) => {
    const sourceCount = e.sources.length;
    const migraine = (e.atcPrefixes ?? []).some(p => p.toUpperCase().startsWith('N02C'));
    return {
      e,
      sourceCount,
      migraine,
      name: e.name.toLowerCase(),
    };
  });

  scored.sort((a, b) => {
    if (b.sourceCount !== a.sourceCount) {
      return b.sourceCount - a.sourceCount;
    }
    if (b.migraine !== a.migraine) {
      return b.migraine ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  return scored.slice(0, 1000).map(x => x.e);
}

async function fetchJsonToTmp(args: { url: string; tmpPath: string }): Promise<any> {
  const res = await fetch(args.url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${args.url}`);
  }
  const json = await res.json();
  await fs.mkdir(path.dirname(args.tmpPath), { recursive: true });
  await fs.writeFile(args.tmpPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return json;
}

async function loadUkraineSource(): Promise<SeedEntry[]> {
  const repoRoot = process.cwd();
  const filePath = path.join(repoRoot, 'reestr.json');
  const raw = await fs.readFile(filePath, 'utf8');
  // Some exports contain unescaped ASCII control chars (e.g. U+001C) inside strings.
  // JSON doesn't allow them; sanitize to keep the dataset usable.
  // eslint-disable-next-line no-control-regex
  const sanitized = raw.replace(/[\u0000-\u0008\v\f\u000E-\u001F]/g, ' ');
  const rows = JSON.parse(sanitized) as Array<Record<string, any>>;

  const entries: SeedEntry[] = [];

  for (const row of rows) {
    const brandName = normalizeName(String(row['Торгівельне найменування'] ?? ''));
    const innName = normalizeName(String(row['Міжнародне непатентоване найменування'] ?? ''));
    if (!brandName && !innName) {
      continue;
    }

    const atcPrefixes: string[] = [];
    for (const key of ['Код АТС 1', 'Код АТС 2', 'Код АТС 3']) {
      const v = normalizeName(String(row[key] ?? ''));
      if (!v) {
        continue;
      }
      const m = v.match(/[A-Z]\d{2}[A-Z0-9]{0,3}/i);
      if (m) {
        atcPrefixes.push(m[0]!.toUpperCase());
      }
    }

    if (brandName) {
      entries.push({
        name: brandName,
        sources: ['ua_reestr'],
        atcPrefixes: atcPrefixes.length ? Array.from(new Set(atcPrefixes)) : undefined,
        type: 'brand',
      });
    }

    if (innName) {
      entries.push({
        name: innName,
        sources: ['ua_reestr'],
        atcPrefixes: atcPrefixes.length ? Array.from(new Set(atcPrefixes)) : undefined,
        type: 'ingredient',
      });
    }
  }

  return entries;
}

async function loadUsSource(tmpDir: string): Promise<SeedEntry[]> {
  // RxClass ATC N02C members (ingredients/classes)
  const url = 'https://rxnav.nlm.nih.gov/REST/rxclass/classMembers.json?classId=N02C&relaSource=ATC';
  const json = await fetchJsonToTmp({ url, tmpPath: path.join(tmpDir, 'us_rxclass_n02c.json') });
  const group = json?.minConceptGroup;
  const concepts: Array<{ name?: string }> = group?.minConcept ?? [];
  const names = concepts.map(c => normalizeName(c.name ?? '')).filter(Boolean);

  return names.map(name => ({
    name,
    sources: ['us_rxnav'],
    atcPrefixes: ['N02C'],
    type: 'ingredient',
  }));
}

async function loadCanadaSource(tmpDir: string): Promise<SeedEntry[]> {
  // Health Canada DPD API: best-effort collection
  const tcUrl = 'https://health-products.canada.ca/api/drug/therapeuticclass/?type=json';
  const classes = await fetchJsonToTmp({ url: tcUrl, tmpPath: path.join(tmpDir, 'ca_therapeuticclass.json') });
  const n02c = (classes as any[])
    .filter(x => typeof x?.tc_atc === 'string' && x.tc_atc.startsWith('N02C'));

  // The API doesn't provide product names here directly; attempt to fetch drug products and filter.
  const dpUrl = 'https://health-products.canada.ca/api/drug/drugproduct/?type=json';
  const drugProducts = await fetchJsonToTmp({ url: dpUrl, tmpPath: path.join(tmpDir, 'ca_drugproduct.json') });

  const results: SeedEntry[] = [];
  const atcPrefixes = Array.from(new Set(n02c.map(x => String(x.tc_atc))));

  for (const p of (drugProducts as any[])) {
    const name = normalizeName(String(p?.brand_name ?? p?.product_name ?? ''));
    if (!name) {
      continue;
    }
    results.push({
      name,
      sources: ['ca_dpd'],
      atcPrefixes: atcPrefixes.length ? atcPrefixes : undefined,
      type: 'brand',
    });
  }

  return results;
}

function dedupe(entries: SeedEntry[]): SeedEntry[] {
  const map = new Map<string, SeedEntry>();

  for (const e of entries) {
    const key = e.name.trim().toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...e, name: normalizeName(e.name) });
      continue;
    }
    const sources = Array.from(new Set([...prev.sources, ...e.sources]));
    const atcPrefixes = Array.from(new Set([...(prev.atcPrefixes ?? []), ...(e.atcPrefixes ?? [])]));
    map.set(key, {
      ...prev,
      sources,
      atcPrefixes: atcPrefixes.length ? atcPrefixes : undefined,
      // Prefer "ingredient" over others if any source says so.
      type: (prev.type === 'ingredient' || e.type === 'ingredient')
        ? 'ingredient'
        : (prev.type === 'generic' || e.type === 'generic') ? 'generic' : 'brand',
    });
  }

  return [...map.values()];
}

async function main() {
  const { skipUs, skipCa, skipUa } = parseArgs(process.argv.slice(2));

  const all: SeedEntry[] = [];
  const tmpDir = path.join(process.cwd(), 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });

  if (!skipUa) {
    console.log('UA: parsing local reestr.json…');
    const ua = await loadUkraineSource();
    console.log(`UA: loaded ${ua.length} raw rows`);
    all.push(...ua);
  } else {
    console.log('UA: skipped');
  }

  if (!skipUs) {
    try {
      console.log('US: fetching RxNav RxClass N02C members…');
      const us = await loadUsSource(tmpDir);
      console.log(`US: loaded ${us.length} raw rows`);
      all.push(...us);
    } catch (e: any) {
      console.log(`US: failed (${e?.message ?? e}), continuing`);
    }
  }
  if (!skipCa) {
    try {
      console.log('CA: fetching Health Canada DPD…');
      const ca = await loadCanadaSource(tmpDir);
      console.log(`CA: loaded ${ca.length} raw rows`);
      all.push(...ca);
    } catch (e: any) {
      console.log(`CA: failed (${e?.message ?? e}), continuing`);
    }
  }

  const before = all.length;
  const deduped = dedupe(all);
  const final = ensureAtMost1000(deduped);

  const outDir = path.join(process.cwd(), 'src', 'lib', 'medications');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'migraine_products_top1000.json');
  await fs.writeFile(outFile, `${JSON.stringify(final, null, 2)}\n`, 'utf8');

  console.log('---');
  console.log(`raw: ${before}`);
  console.log(`deduped: ${deduped.length}`);
  console.log(`final: ${final.length}`);
  console.log(`wrote: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
