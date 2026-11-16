import type { ProgramDefinitionFrontmatterT } from './programDefinitionSchema';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { join } from 'node:path';
import {
  ProgramDefinitionFrontmatter,
} from './programDefinitionSchema';

export type ProgramDefinition = {
  frontmatter: ProgramDefinitionFrontmatterT;
  /** Default-locale (English) body. Use `getProgramBody(id, locale)` for translated bodies. */
  body: string;
};

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'fr', 'uk'] as const;
export type ProgramLocale = (typeof SUPPORTED_LOCALES)[number];

let cache: ProgramDefinition[] | null = null;

function contentDir(): string {
  return join(process.cwd(), 'content', 'programs');
}

function readBody(slug: string, locale: ProgramLocale): string | null {
  const dir = contentDir();
  const localised = join(dir, `${slug}.${locale}.md`);
  if (existsSync(localised)) {
    return readFileSync(localised, 'utf8').trim();
  }
  return null;
}

function loadAll(): ProgramDefinition[] {
  const dir = contentDir();
  const jsonFiles = readdirSync(dir).filter(f => f.endsWith('.json'));

  const defs: ProgramDefinition[] = jsonFiles.map((jsonFile) => {
    const slug = jsonFile.replace(/\.json$/, '');
    const rawFrontmatter = readFileSync(join(dir, jsonFile), 'utf8');
    const result = ProgramDefinitionFrontmatter.safeParse(JSON.parse(rawFrontmatter));
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${jsonFile}: ${result.error.message}`);
    }

    // Default body: <slug>.md (English, the canonical source).
    const defaultBody = readFileSync(join(dir, `${slug}.md`), 'utf8').trim();
    return { frontmatter: result.data, body: defaultBody };
  });

  defs.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
  return defs;
}

export function getProgramDefinitions(): ProgramDefinition[] {
  if (!cache) {
    cache = loadAll();
  }
  return cache;
}

export function getProgramDefinition(id: string): ProgramDefinition | undefined {
  return getProgramDefinitions().find(d => d.frontmatter.id === id);
}

/**
 * Returns the program body markdown in the requested locale, falling back to
 * English when no locale-specific file exists. Frontmatter (target windows,
 * citation metadata) is locale-agnostic and lives in the JSON file.
 */
export function getProgramBody(id: string, locale: string): string | undefined {
  const def = getProgramDefinition(id);
  if (!def) {
    return undefined;
  }
  const supportedLocale = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as ProgramLocale)
    : DEFAULT_LOCALE;
  if (supportedLocale === DEFAULT_LOCALE) {
    return def.body;
  }
  return readBody(id, supportedLocale) ?? def.body;
}
