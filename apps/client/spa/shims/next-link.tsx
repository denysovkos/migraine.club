// next/link on react-router: the same <a href> in the DOM; internal clicks
// navigate on the client through the locale rules of next-intl's middleware.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { useNavigate } from 'react-router';

import { middlewareHref } from './locale-state';

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

export default function Link({ href, replace, scroll: _scroll, prefetch: _prefetch, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, locale: _locale, onNavigate, ref, children, onClick, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const to = formatHref(href);
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || isExternal(to) || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey
      || (rest.target && rest.target !== '_self') || rest.download !== undefined) {
      return;
    }
    let prevented = false;
    onNavigate?.({ preventDefault: () => {
      prevented = true;
    } });
    e.preventDefault();
    if (!prevented) {
      void navigate(middlewareHref(to), { replace });
    }
  };
  return <a ref={ref} {...rest} href={to} onClick={handleClick}>{children}</a>;
}
