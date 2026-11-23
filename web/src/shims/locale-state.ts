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

// ---------- next-intl middleware, client side ----------
//
// In Next every navigation went through the server, where next-intl's
// middleware prefixed unprefixed paths with the cookie's locale, dropped the
// default locale's prefix and kept the NEXT_LOCALE cookie in step. Client
// navigations here apply the same rules (internal/spa/locale.go is the
// server half).

const COOKIE = 'NEXT_LOCALE';
const SKIPS = /^\/(?:.+\.\w+$|_next|monitoring|share|\.well-known|sw\.js|manifest\.webmanifest|api|trpc|admin)/;

function readCookie(): string | undefined {
  const raw = document.cookie.split('; ').find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return raw && (LOCALES as readonly string[]).includes(raw) ? raw : undefined;
}

/** The browser's Accept-Language locale, or undefined like next-intl's matcher. */
function acceptLanguageLocale(): string | undefined {
  for (const tag of navigator.languages ?? []) {
    const primary = tag.split('-')[0]!.toLowerCase();
    if ((LOCALES as readonly string[]).includes(primary)) {
      return primary;
    }
  }
  return navigator.languages?.length ? DEFAULT_LOCALE : undefined;
}

function syncCookie(locale: string) {
  const cookie = readCookie();
  if (cookie ? cookie !== locale : acceptLanguageLocale() !== locale) {
    document.cookie = `${COOKIE}=${locale}; path=/; samesite=lax`;
  }
}

/** Where next-intl's middleware sent a navigation to `href`. */
export function middlewareHref(href: string): string {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin || SKIPS.test(url.pathname)) {
    return href;
  }
  const path = url.pathname.replace(/\/+/g, '/');
  const first = path.split('/')[1] ?? '';
  const matched = (LOCALES as readonly string[]).find(l => l === first.toLowerCase());
  const rest = matched ? path.slice(first.length + 1) || '/' : path;
  const normalized = rest !== '/' ? rest.replace(/\/$/, '') : rest;
  const locale = matched ?? readCookie() ?? acceptLanguageLocale() ?? DEFAULT_LOCALE;
  syncCookie(locale);
  const prefixed = locale === DEFAULT_LOCALE ? normalized : `/${locale}${normalized === '/' ? '' : normalized}`;
  return `${prefixed}${url.search}${url.hash}`;
}
