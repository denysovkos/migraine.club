// The locale the current route renders in and its messages, set by the
// locale route's loader before any page code runs (what next-intl's request
// config provided on the server).
import type { AbstractIntlMessages } from 'use-intl';

export const LOCALES = ['en', 'fr', 'uk'] as const;
export const DEFAULT_LOCALE = 'en';

let current: { locale: string; messages: AbstractIntlMessages } = { locale: DEFAULT_LOCALE, messages: {} };
const cache = new Map<string, AbstractIntlMessages>();

const loaders: Record<string, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import('@/locales/en.json'),
  fr: () => import('@/locales/fr.json'),
  uk: () => import('@/locales/uk.json'),
};

export async function loadLocale(locale: string): Promise<{ locale: string; messages: AbstractIntlMessages }> {
  const safe = (LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
  if (!cache.has(safe)) {
    cache.set(safe, (await loaders[safe]!()).default);
  }
  current = { locale: safe, messages: cache.get(safe)! };
  return current;
}

export function currentLocale() {
  return current;
}

/** The locale a path belongs to under localePrefix 'as-needed'. */
export function localeOfPath(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';
  return (LOCALES as readonly string[]).includes(first) && first !== DEFAULT_LOCALE ? first : DEFAULT_LOCALE;
}
