// next/navigation on react-router. Server-only helpers (redirect, notFound)
// throw what the route loaders turn into a navigation or the 404 page.
import { useMemo } from 'react';
import { redirect as rrRedirect, useLocation, useNavigate, useRevalidator, useParams as useRRParams, useSearchParams as useRRSearchParams } from 'react-router';

export class NotFoundError extends Error {
  digest = 'NEXT_NOT_FOUND';
}

export function redirect(url: string): never {
  throw rrRedirect(url);
}

export function permanentRedirect(url: string): never {
  throw rrRedirect(url, 308);
}

export function notFound(): never {
  throw new NotFoundError('NEXT_NOT_FOUND');
}

/** Lets redirects and 404s through a catch block, as Next's did. */
export function unstable_rethrow(error: unknown): void {
  if (error instanceof Response || error instanceof NotFoundError) {
    throw error;
  }
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRRSearchParams()[0];
}

export function useParams<T extends Record<string, string | string[]>>(): T {
  return useRRParams() as unknown as T;
}

type NavigateOptions = { scroll?: boolean };

export function useRouter() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  return useMemo(() => ({
    push: (href: string, _options?: NavigateOptions) => void navigate(href),
    replace: (href: string, _options?: NavigateOptions) => void navigate(href, { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => void revalidator.revalidate(),
    prefetch: (_href: string) => {},
  }), [navigate, revalidator]);
}

export const RedirectType = { push: 'push', replace: 'replace' } as const;
