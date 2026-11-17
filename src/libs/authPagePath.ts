/**
 * Localized pages whose server code calls Clerk's `auth()`, so the proxy must
 * run `clerkMiddleware` on them: the dashboard and attack mode (`/quick/attack`),
 * with or without a locale prefix.
 */
const AUTH_PAGE_PATH = /^(?:\/[^/]+)?\/(?:dashboard|quick\/attack)(?:\/|$)/;

export function isAuthPagePath(pathname: string): boolean {
  return AUTH_PAGE_PATH.test(pathname);
}
