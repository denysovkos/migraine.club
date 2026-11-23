// next-intl/navigation's createNavigation for localePrefix 'as-needed':
// pathnames without the locale prefix, navigation that adds it back.
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

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
  const prefix = (href: string, locale: string) => {
    if (locale === defaultLocale) {
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
      push: (href: string, opts?: { locale?: string }) => void navigate(prefix(href, opts?.locale ?? current)),
      replace: (href: string, opts?: { locale?: string }) => void navigate(prefix(href, opts?.locale ?? current), { replace: true }),
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh: () => {},
      prefetch: () => {},
    }), [navigate, current]);
  }
  return { usePathname, useRouter };
}
