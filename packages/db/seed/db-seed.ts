import fs from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/schema';
import { containsCyrillic, cyrillicToLatinVariants } from './transliterate';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const db = drizzlePg(pool, { schema, logger: true });
const { medicationsCatalogSchema } = schema;

type SeedEntry = {
  name: string;
  sources: string[];
  atcPrefixes?: string[];
  type: 'brand' | 'generic' | 'ingredient';
  aliases?: string[];
};

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function normalizeLc(input: string): string {
  return normalizeName(input).toLowerCase();
}

async function readTop1000Json(): Promise<SeedEntry[]> {
  const filePath = path.join(import.meta.dirname, 'migraine_products_top1000.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as SeedEntry[];
}

async function readJsonCached<T>(args: { url: string; cachePath: string }): Promise<T> {
  try {
    const raw = await fs.readFile(args.cachePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    const res = await fetch(args.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${args.url}`);
    }
    const json = await res.json();
    await fs.mkdir(path.dirname(args.cachePath), { recursive: true });
    await fs.writeFile(args.cachePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    return json as T;
  }
}

function sanitizeBrokenJson(input: string): string {
  // Remove illegal ASCII control chars inside strings (some exports contain U+001C).
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\v\f\u000E-\u001F]/g, ' ');
}

async function loadUkraineReestr(): Promise<SeedEntry[]> {
  const filePath = path.join(import.meta.dirname, 'reestr.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(sanitizeBrokenJson(raw)) as Array<Record<string, any>>;

  const out: SeedEntry[] = [];

  for (const row of rows) {
    const brand = normalizeName(String(row['Торгівельне найменування'] ?? ''));
    const inn = normalizeName(String(row['Міжнародне непатентоване найменування'] ?? ''));

    const atcPrefixes: string[] = [];
    for (const k of ['Код АТС 1', 'Код АТС 2', 'Код АТС 3']) {
      const v = normalizeName(String(row[k] ?? ''));
      const m = v.match(/[A-Z]\d{2}[A-Z0-9]{0,3}/i);
      if (m) {
        atcPrefixes.push(m[0]!.toUpperCase());
      }
    }

    if (inn) {
      out.push({
        name: inn,
        sources: ['ua_reestr'],
        atcPrefixes: atcPrefixes.length ? Array.from(new Set(atcPrefixes)) : undefined,
        type: 'ingredient',
      });
    }
    if (brand) {
      out.push({
        name: brand,
        sources: ['ua_reestr'],
        atcPrefixes: atcPrefixes.length ? Array.from(new Set(atcPrefixes)) : undefined,
        type: 'brand',
      });
    }
  }

  return out;
}

async function loadUsRxNavAndRxNorm(tmpDir: string): Promise<SeedEntry[]> {
  const classIds = ['N02C', 'N02CA', 'N02CB', 'N02CC', 'N02CD', 'N02CX'];
  const memberNames = new Map<string, SeedEntry>();
  const rxcuis = new Set<string>();

  for (const classId of classIds) {
    const url = `https://rxnav.nlm.nih.gov/REST/rxclass/classMembers.json?classId=${encodeURIComponent(classId)}&relaSource=ATC`;
    const json: any = await readJsonCached({ url, cachePath: path.join(tmpDir, `us_rxclass_${classId}.json`) });
    const concepts: any[] = json?.minConceptGroup?.minConcept ?? [];
    for (const c of concepts) {
      const name = normalizeName(String(c?.name ?? ''));
      const rxcui = String(c?.rxcui ?? '');
      if (rxcui) {
        rxcuis.add(rxcui);
      }
      if (!name) {
        continue;
      }
      memberNames.set(normalizeLc(name), {
        name,
        sources: ['us_rxnav'],
        atcPrefixes: [classId],
        type: 'ingredient',
      });
    }
  }

  // Expand via RxNorm (brand/generic/ingredient names).
  const expanded: SeedEntry[] = [];
  const list = [...rxcuis];
  const concurrency = 6;
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      const rxcui = list[i]!;
      const url = `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/allrelated.json`;
      try {
        const json: any = await readJsonCached({ url, cachePath: path.join(tmpDir, `us_rxcui_${rxcui}.json`) });
        const groups: any[] = json?.allRelatedGroup?.conceptGroup ?? [];
        for (const g of groups) {
          const tty = String(g?.tty ?? '');
          const concepts: any[] = g?.conceptProperties ?? [];
          for (const c of concepts) {
            const name = normalizeName(String(c?.name ?? ''));
            if (!name) {
              continue;
            }
            const type: SeedEntry['type']
              = tty === 'BN'
                ? 'brand'
                : (tty === 'IN' || tty === 'PIN' || tty === 'MIN')
                    ? 'ingredient'
                    : 'generic';
            expanded.push({
              name,
              sources: ['us_rxnorm'],
              atcPrefixes: ['N02C'],
              type,
            });
          }
        }
      } catch {
        // best-effort
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return [...memberNames.values(), ...expanded];
}

async function loadCanadaDpd(tmpDir: string): Promise<SeedEntry[]> {
  // Best-effort: API is large; cache raw responses in tmp.
  // Try to fetch therapeuticclass list and derive drug_codes when available.
  const tcUrl = 'https://health-products.canada.ca/api/drug/therapeuticclass/?type=json';
  const tc: any[] = await readJsonCached({ url: tcUrl, cachePath: path.join(tmpDir, 'ca_therapeuticclass.json') });
  const n02c = tc.filter(x => typeof x?.tc_atc === 'string' && x.tc_atc.startsWith('N02C'));
  const drugCodes = new Set<string>();
  for (const r of n02c) {
    if (r?.drug_code) {
      drugCodes.add(String(r.drug_code));
    }
  }

  const results: SeedEntry[] = [];
  if (drugCodes.size > 0) {
    // Fetch drugproduct per drug_code if supported; otherwise fall back to full dataset.
    const codes = [...drugCodes];
    for (let i = 0; i < Math.min(codes.length, 2000); i++) {
      const code = codes[i]!;
      const url = `https://health-products.canada.ca/api/drug/drugproduct/?type=json&drug_code=${encodeURIComponent(code)}`;
      try {
        const products: any[] = await readJsonCached({ url, cachePath: path.join(tmpDir, `ca_drugproduct_${code}.json`) });
        for (const p of products) {
          const name = normalizeName(String(p?.brand_name ?? p?.product_name ?? p?.drug_product_name ?? ''));
          if (!name) {
            continue;
          }
          results.push({
            name,
            sources: ['ca_dpd'],
            atcPrefixes: ['N02C'],
            type: 'brand',
          });
        }
      } catch {
        // ignore
      }
    }
    return results;
  }

  // Fallback: attempt full drugproduct dataset and keep migraine-ish by name keyword (still best-effort).
  const dpUrl = 'https://health-products.canada.ca/api/drug/drugproduct/?type=json';
  const products: any[] = await readJsonCached({ url: dpUrl, cachePath: path.join(tmpDir, 'ca_drugproduct_all.json') });
  for (const p of products) {
    const name = normalizeName(String(p?.brand_name ?? p?.product_name ?? p?.drug_product_name ?? ''));
    if (!name) {
      continue;
    }
    results.push({
      name,
      sources: ['ca_dpd'],
      atcPrefixes: ['N02C'],
      type: 'brand',
    });
  }
  return results;
}

function mergeEntries(entries: SeedEntry[]): Array<{
  canonicalName: string;
  canonicalNameLc: string;
  aliases: string[];
  searchText: string;
  tags: string[];
}> {
  const byLc = new Map<string, {
    canonicalName: string;
    aliases: Set<string>;
    tags: Set<string>;
  }>();

  for (const e of entries) {
    const name = normalizeName(e.name);
    if (!name) {
      continue;
    }
    const lc = normalizeLc(name);
    const cur = byLc.get(lc) ?? {
      canonicalName: name,
      aliases: new Set<string>(),
      tags: new Set<string>(),
    };

    // Store source/type/atc as tags
    cur.tags.add(`type:${e.type}`);
    for (const s of e.sources) {
      cur.tags.add(`source:${s}`);
    }
    for (const a of (e.atcPrefixes ?? [])) {
      cur.tags.add(`atc:${a}`);
    }
    for (const a of (e.aliases ?? [])) {
      const na = normalizeName(a);
      if (na && normalizeLc(na) !== lc) {
        cur.aliases.add(na);
      }
    }

    byLc.set(lc, cur);
  }

  const out = [];
  for (const [lc, v] of byLc.entries()) {
    const aliases = [...v.aliases];
    const tags = [...v.tags];
    // Include transliteration in search_text to support cross-script fuzzy search
    // (e.g. user types "нурофен" but name exists as "Nurofen", or vice-versa).
    const pieces: string[] = [v.canonicalName, ...aliases];
    for (const p of [...pieces]) {
      if (containsCyrillic(p)) {
        const vars = cyrillicToLatinVariants(p, 4);
        for (const vv of vars) {
          pieces.push(vv);
        }
      }
    }
    const searchText = normalizeName(pieces.join(' '));
    out.push({
      canonicalName: v.canonicalName,
      canonicalNameLc: lc,
      aliases,
      searchText,
      tags,
    });
  }
  return out;
}

async function seedMedicationsCatalogFull() {
  const tmpDir = path.join(process.cwd(), 'tmp', 'seed-cache');
  await fs.mkdir(tmpDir, { recursive: true });

  console.log('Collecting medication catalog sources…');

  const collected: SeedEntry[] = [];

  // Local curated list (kept as a source)
  try {
    const top = await readTop1000Json();
    collected.push(...top.map(e => ({ ...e, sources: [...e.sources, 'top1000'] })));
    console.log(`- top1000: ${top.length}`);
  } catch {
    console.log('- top1000: missing (skipped)');
  }

  // UA reestr.json
  const ua = await loadUkraineReestr();
  collected.push(...ua);
  console.log(`- ua_reestr: ${ua.length}`);

  // US RxNav + RxNorm
  const us = await loadUsRxNavAndRxNorm(tmpDir);
  collected.push(...us);
  console.log(`- us_rxnav+rxnorm: ${us.length}`);

  // CA DPD
  try {
    const ca = await loadCanadaDpd(tmpDir);
    collected.push(...ca);
    console.log(`- ca_dpd: ${ca.length}`);
  } catch (e: any) {
    console.log(`- ca_dpd: failed (${e?.message ?? e}), continuing`);
  }

  console.log(`Total raw: ${collected.length}`);
  const merged = mergeEntries(collected);
  console.log(`Deduped canonical: ${merged.length}`);

  // Bulk upsert by canonical_name_lc
  const batchSize = 500;
  for (let i = 0; i < merged.length; i += batchSize) {
    const batch = merged.slice(i, i + batchSize);
    await db
      .insert(medicationsCatalogSchema)
      .values(batch.map(b => ({
        canonicalName: b.canonicalName,
        canonicalNameLc: b.canonicalNameLc,
        aliases: b.aliases,
        searchText: b.searchText,
        tags: b.tags,
      })))
      .onConflictDoUpdate({
        target: medicationsCatalogSchema.canonicalNameLc,
        set: {
          canonicalName: sql`excluded.canonical_name`,
          aliases: sql`excluded.aliases`,
          searchText: sql`excluded.search_text`,
          tags: sql`excluded.tags`,
        },
      });

    console.log(`  upserted ${Math.min(i + batchSize, merged.length)}/${merged.length}`);
  }
}

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set (db:seed uses dotenv -c production)');
    }
    await seedMedicationsCatalogFull();
    console.log('Done.');
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
