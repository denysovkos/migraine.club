// next-intl/navigation's createNavigation for localePrefix 'as-needed':
// pathnames without the locale prefix, navigation that adds it back.
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { middlewareHref } from './locale-state';

type Config = { locales: readonly string[]; defaultLocale: string };

export function createNavigation({ locales, defaultLocale }: Config) {
  const strip = (pathname: string) => {
    const first = pathname.split('/')[1] ?? '';
    if (locales.includes(first)) {
      const rest = pathname.slice(first.length + 1);
      return rest === '' ? '/' : rest;
    }
    return pathname;
  };
  // next-intl forces the prefix when the locale changes, so the middleware
  // updates the cookie (and then drops the default locale's prefix again).
  const prefix = (href: string, locale: string, force = false) => {
    if (locale === defaultLocale && !force) {
      return href;
    }
    return href === '/' ? `/${locale}` : `/${locale}${href}`;
  };
  function usePathname(): string {
    return strip(useLocation().pathname);
  }
  function useRouter() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const first = pathname.split('/')[1] ?? '';
    const current = locales.includes(first) ? first : defaultLocale;
    return useMemo(() => ({
      push: (href: string, opts?: { locale?: string }) => void navigate(middlewareHref(prefix(href, opts?.locale ?? current, opts?.locale !== undefined && opts.locale !== current))),
      replace: (href: string, opts?: { locale?: string }) => void navigate(middlewareHref(prefix(href, opts?.locale ?? current, opts?.locale !== undefined && opts.locale !== current)), { replace: true }),
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh: () => {},
      prefetch: () => {},
    }), [navigate, current]);
  }
  return { usePathname, useRouter };
}
