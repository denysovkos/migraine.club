// Clerk's UI strings per app locale. English is small and always bundled;
// French and Ukrainian (about 170 kB each) load only for their locales, in
// the locale route's loader (spa/shims/locale-state.ts), before any layout
// renders. The barrel import of @clerk/localizations pulled them into
// every page.
import { enUS } from '@clerk/localizations/en-US';

export type ClerkLocalization = typeof enUS;

const loaded = new Map<string, ClerkLocalization>([['en', enUS]]);

const loaders: Record<string, () => Promise<ClerkLocalization>> = {
  fr: () => import('@clerk/localizations/fr-FR').then(m => m.frFR),
  uk: () => import('@clerk/localizations/uk-UA').then(m => m.ukUA),
};

/** Loads a locale's Clerk strings (a no-op for English and once loaded). */
export async function loadClerkLocalization(locale: string): Promise<void> {
  const load = loaders[locale];
  if (load && !loaded.has(locale)) {
    loaded.set(locale, await load());
  }
}

/** A loaded locale's Clerk strings; English for anything not loaded. */
export function clerkLocalization(locale: string): ClerkLocalization {
  return loaded.get(locale) ?? enUS;
}
