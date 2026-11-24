// The locale the current route renders in and its messages, set by the
// locale route's loader before any page code runs (what next-intl's request
// config provided on the server).
import type { AbstractIntlMessages } from 'use-intl';

export const LOCALES = ['en', 'fr', 'uk'] as const;
export const DEFAULT_LOCALE = 'en';

let current: { locale: string; messages: AbstractIntlMessages } = { locale: DEFAULT_LOCALE, messages: {} };
const cache = new Map<string, AbstractIntlMessages>();

const loaders: Record<string, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import('@migraine/locales/en.json'),
  fr: () => import('@migraine/locales/fr.json'),
  uk: () => import('@migraine/locales/uk.json'),
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
// In Next every client navigation fetched the new route from the server,
// where next-intl's middleware ran: it prefixed unprefixed paths with the
// cookie's locale and dropped the default locale's prefix, and the fetch
// followed those redirects. Those fetches are not documents
// (Sec-Fetch-Dest: empty), so the middleware never wrote the cookie for
// them. Client navigations here follow the same redirects without touching
// the cookie (internal/spa/locale.go is the server half, for documents).

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

/** next-intl's syncLocaleCookie: what its router does when switching locale. */
export function setLocaleCookie(current: string, next: string) {
  if (next !== current) {
    document.cookie = `${COOKIE}=${next};sameSite=lax;path=/;`;
  }
}

function prefixed(locale: string, pathname: string): string {
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
}

/** One pass of the middleware over a pathname: where it redirected, if anywhere. */
function redirectOf(pathname: string): string | undefined {
  const path = pathname.replace(/\/+/g, '/');
  const first = path.split('/')[1] ?? '';
  const matched = (LOCALES as readonly string[]).find(l => l === first.toLowerCase());
  const rest = matched ? path.slice(first.length + 1) || '/' : path;
  const unprefixed = rest !== '/' ? rest.replace(/\/$/, '') : rest;
  const locale = matched ?? readCookie() ?? acceptLanguageLocale() ?? DEFAULT_LOCALE;
  if (matched) {
    if (first !== matched) {
      return prefixed(matched, unprefixed);
    }
    return matched === DEFAULT_LOCALE ? unprefixed : undefined;
  }
  return locale === DEFAULT_LOCALE ? undefined : prefixed(locale, unprefixed);
}

/** Where a client navigation to `href` ended up after next-intl's redirects. */
export function middlewareHref(href: string): string {
  // Outside the browser (the prerender) a redirect is a plain 307 the
  // server answers with; the middleware sees the next request.
  if (typeof window === 'undefined') {
    return href;
  }
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin || SKIPS.test(url.pathname)) {
    return href;
  }
  let pathname = url.pathname;
  for (let hops = 0; hops < 10; hops++) {
    const next = redirectOf(pathname);
    if (next === undefined || next === pathname) {
      break;
    }
    pathname = next;
  }
  return `${pathname}${url.search}${url.hash}`;
}
