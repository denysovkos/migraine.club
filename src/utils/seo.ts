import { AllLocales, AppConfig } from '@/utils/AppConfig';
import { getBaseUrl } from '@/utils/Helpers';

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  // Remove trailing slash except for root
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * For localePrefix='as-needed':
 * - default locale: /product
 * - non-default: /fr/product
 * - locale root: /fr (no trailing slash)
 */
export function getLocalizedPathname(locale: string, pathname: string): string {
  const clean = normalizePathname(pathname);

  if (locale === AppConfig.defaultLocale) {
    return clean;
  }

  if (clean === '/') {
    return `/${locale}`;
  }

  return `/${locale}${clean}`;
}

export function getAbsoluteUrl(pathname: string): string {
  const base = getBaseUrl();
  const clean = normalizePathname(pathname);
  return `${base}${clean === '/' ? '' : clean}`;
}

export function getLanguageAlternates(pathname: string): Record<string, string> {
  const clean = normalizePathname(pathname);

  const languages: Record<string, string> = {};
  for (const locale of AllLocales) {
    languages[locale] = getAbsoluteUrl(getLocalizedPathname(locale, clean));
  }

  // Helps Google when no language match is clear.
  languages['x-default'] = languages[AppConfig.defaultLocale]!;

  return languages;
}

export function getPageAlternates(locale: string, pathname: string) {
  const clean = normalizePathname(pathname);
  const canonical = getAbsoluteUrl(getLocalizedPathname(locale, clean));
  return {
    canonical,
    languages: getLanguageAlternates(clean),
  };
}
