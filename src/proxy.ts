import type { NextFetchEvent, NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';

import { getE2EMockUserId, isE2EMockAuth } from './libs/E2EAuth';
import { AllLocales, AppConfig } from './utils/AppConfig';

const intlMiddleware = createMiddleware({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});

// Auth is enforced where the data lives, not here: every API route handler
// checks `auth()` and returns 401, and protected pages/layouts call
// `requireUserOrRedirect` (src/libs/AuthGuard.ts). This proxy only has to make
// sure `clerkMiddleware` runs on the requests whose server code calls `auth()`.
// See https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher
const DASHBOARD_PATH = /^(?:\/[^/]+)?\/dashboard(?:\/|$)/;

// clerkMiddleware with no auth checks: it only attaches the auth state that
// `auth()` reads. `auth()` throws on requests clerkMiddleware didn't run on.
const withClerk = clerkMiddleware();

export default function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  // E2E mock-auth bypass: skip Clerk entirely and stamp a synthetic user header.
  // Server `auth()` reads `x-e2e-mock-user` via src/libs/MockClerkServer.ts when
  // aliased, falling back to the same env-derived id when the header is absent
  // (see src/libs/E2EAuth.ts) — every e2e spec in this repo runs as one fixed
  // mock user, so that fallback always resolves to the same id as the header.
  if (isE2EMockAuth()) {
    if (
      request.nextUrl.pathname.startsWith('/api')
      || request.nextUrl.pathname.startsWith('/admin')
    ) {
      const userId = getE2EMockUserId();
      const headers = new Headers(request.headers);
      headers.set('x-e2e-mock-user', userId);
      return NextResponse.next({ request: { headers } });
    }

    // Run next-intl on the real NextRequest. Reconstructing a plain `Request`
    // here (as a previous version of this branch did, to carry the mock
    // header) loses `nextUrl` and other NextRequest-only properties that
    // next-intl's middleware relies on to resolve/rewrite the locale — which
    // silently broke routing for any unprefixed default-locale path (e.g.
    // `/dashboard`, `/onboarding`) under mock auth only, since the header
    // isn't actually needed here (the env fallback above covers it).
    return intlMiddleware(request);
  }

  // API routes should only go through Clerk auth, not intl middleware
  if (request.nextUrl.pathname.startsWith('/api')) {
    // Public API routes (share token validation)
    if (request.nextUrl.pathname.startsWith('/api/share/') && request.method === 'GET') {
      return NextResponse.next();
    }

    // Cron API routes - protected by CRON_SECRET header, not Clerk
    if (request.nextUrl.pathname.startsWith('/api/cron/')) {
      return NextResponse.next();
    }

    // Everything else, including the MCP endpoint (Clerk OAuth bearer token,
    // verified by the route's own `withMcpAuth`), authenticates in the handler.
    return withClerk(request, event);
  }

  // Admin routes are not localized; avoid next-intl rewrites/redirects.
  // The admin pages check auth and the admin role themselves.
  if (request.nextUrl.pathname.startsWith('/admin')) {
    return withClerk(request, event);
  }

  if (
    request.nextUrl.pathname.includes('/sign-in')
    || request.nextUrl.pathname.includes('/sign-up')
    || DASHBOARD_PATH.test(request.nextUrl.pathname)
  ) {
    return clerkMiddleware(async (_auth, req) => intlMiddleware(req))(request, event);
  }

  return intlMiddleware(request);
}

export const config = {
  // Exclude: static files, _next, monitoring (Sentry), /share routes, OAuth
  // discovery documents, and PWA assets.
  // `.well-known` must stay excluded: next-intl would otherwise locale-rewrite
  // the OAuth metadata URLs and break MCP client discovery.
  // PWA assets: sw.js, manifest.webmanifest, icons (already covered by .+\.\w+ pattern)
  matcher: ['/((?!.+\\.[\\w]+$|_next|monitoring|share|\\.well-known|sw\\.js|manifest\\.webmanifest).*)', '/', '/(api|trpc)(.*)'],
};
