// next/link on react-router: the same <a href> in the DOM, client-side
// navigation for internal links.
import type { AnchorHTMLAttributes, ReactNode, Ref } from 'react';
import { Link as RRLink } from 'react-router';

type UrlObject = { pathname?: string | null; query?: Record<string, string | number | boolean | string[] | undefined> | string | null; hash?: string | null };

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | UrlObject;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null | 'auto';
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
  onNavigate?: (e: { preventDefault: () => void }) => void;
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
};

// eslint-disable-next-line react-refresh/only-export-components
export function formatHref(href: string | UrlObject): string {
  if (typeof href === 'string') {
    return href;
  }
  let out = href.pathname ?? '';
  if (href.query) {
    const q = typeof href.query === 'string'
      ? href.query
      : new URLSearchParams(Object.entries(href.query).flatMap(([k, v]) =>
          v === undefined ? [] : Array.isArray(v) ? v.map(x => [k, String(x)]) : [[k, String(v)]])).toString();
    if (q) {
      out += `?${q}`;
    }
  }
  if (href.hash) {
    out += href.hash.startsWith('#') ? href.hash : `#${href.hash}`;
  }
  return out;
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//');
}

export default function Link({ href, replace, scroll: _scroll, prefetch: _prefetch, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, locale: _locale, onNavigate: _onNavigate, ref, children, ...rest }: LinkProps) {
  const to = formatHref(href);
  if (isExternal(to) || rest.target === '_blank' || rest.download !== undefined) {
    return <a ref={ref} {...rest} href={to}>{children}</a>;
  }
  return <RRLink ref={ref} to={to} replace={replace} discover="none" {...rest}>{children}</RRLink>;
}
