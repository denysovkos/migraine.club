// next-intl/navigation's createNavigation for localePrefix 'as-needed':
// pathnames without the locale prefix, navigation that adds it back.
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { middlewareHref, setLocaleCookie } from './locale-state';

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
  // next-intl prefixes the path whenever a locale is passed (and writes the
  // cookie when it changes); the middleware then drops the default
  // locale's prefix again.
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
      push: (href: string, opts?: { locale?: string }) => {
        setLocaleCookie(current, opts?.locale ?? current);
        void navigate(middlewareHref(prefix(href, opts?.locale ?? current, opts?.locale !== undefined)));
      },
      replace: (href: string, opts?: { locale?: string }) => {
        setLocaleCookie(current, opts?.locale ?? current);
        void navigate(middlewareHref(prefix(href, opts?.locale ?? current, opts?.locale !== undefined)), { replace: true });
      },
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh: () => {},
      prefetch: () => {},
    }), [navigate, current]);
  }
  return { usePathname, useRouter };
}
