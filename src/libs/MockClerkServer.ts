/**
 * Mock for `@clerk/nextjs/server` used during Playwright e2e tests.
 *
 * Wired via a webpack alias in next.config.mjs when `E2E_MOCK_AUTH=true`.
 * Never bundled into production builds.
 */

import type { NextFetchEvent, NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import {
  E2E_MOCK_USER_EMAIL,
  E2E_MOCK_USER_FIRST_NAME,
  E2E_MOCK_USER_ID_DEFAULT,
  E2E_MOCK_USER_LAST_NAME,
  getE2EMockUserId,
} from './E2EAuth';

const mockUserId = () => {
  // Try the header stamped by middleware first; fall back to env.
  try {
    // headers() may be async in Next 16; both modes handled below.
    const h = (headers as any)();
    if (h && typeof h.get === 'function') {
      const v = h.get('x-e2e-mock-user');
      if (v) {
        return v;
      }
    }
  } catch (error) {
    // Let Next's request-time bailout through, like real Clerk does.
    unstable_rethrow(error);
    // headers() may throw if called outside request scope (e.g. cron). Ignore.
  }
  return getE2EMockUserId();
};

const buildAuthObject = (userId: string) => ({
  userId,
  sessionId: 'e2e_session_001',
  sessionClaims: null,
  actor: null,
  orgId: null,
  orgRole: null,
  orgSlug: null,
  orgPermissions: [],
  has: () => true,
  getToken: async () => 'e2e_token',
  redirectToSignIn: () => NextResponse.next(),
  protect: async () => {},
});

export const auth = async () => {
  // Resolve userId once at call-time. `headers()` is async in Next 16.
  let userId = E2E_MOCK_USER_ID_DEFAULT;
  try {
    const h = await (headers as any)();
    const v = h?.get?.('x-e2e-mock-user');
    if (v) {
      userId = v;
    } else {
      userId = getE2EMockUserId();
    }
  } catch (error) {
    // Real Clerk's auth() reads request headers, which makes the calling page
    // dynamic. Swallowing Next's bailout here made `next build` prerender
    // signed-in pages as the mock user and query the database at build time.
    unstable_rethrow(error);
    userId = mockUserId();
  }
  return buildAuthObject(userId);
};

export const currentUser = async () => {
  const userId = (await auth()).userId;
  return {
    id: userId,
    firstName: E2E_MOCK_USER_FIRST_NAME,
    lastName: E2E_MOCK_USER_LAST_NAME,
    fullName: `${E2E_MOCK_USER_FIRST_NAME} ${E2E_MOCK_USER_LAST_NAME}`,
    username: 'e2e-user',
    imageUrl: '',
    hasImage: false,
    primaryEmailAddress: {
      emailAddress: E2E_MOCK_USER_EMAIL,
      id: 'e2e_email_001',
    },
    primaryEmailAddressId: 'e2e_email_001',
    emailAddresses: [
      { emailAddress: E2E_MOCK_USER_EMAIL, id: 'e2e_email_001' },
    ],
    publicMetadata: {},
    privateMetadata: {},
    unsafeMetadata: {},
  } as any;
};

// Pass-through middleware: no auth checks, just continues.
export const clerkMiddleware = (
  handler?: (
    auth: () => Promise<ReturnType<typeof buildAuthObject>>,
    req: NextRequest,
  ) => Promise<NextResponse | undefined> | NextResponse | undefined,
) => {
  return async (req: NextRequest, _event: NextFetchEvent) => {
    if (handler) {
      const authFn = async () => buildAuthObject(getE2EMockUserId());
      // Augment with `.protect()` directly callable
      (authFn as any).protect = async () => {};
      const result = await handler(authFn as any, req);
      if (result) {
        return result;
      }
    }
    return NextResponse.next();
  };
};

// Stub clerkClient for any callers that use it (e.g. admin).
export const clerkClient = async () => ({
  users: {
    getUser: async (id: string) => ({
      id,
      firstName: E2E_MOCK_USER_FIRST_NAME,
      lastName: E2E_MOCK_USER_LAST_NAME,
      fullName: `${E2E_MOCK_USER_FIRST_NAME} ${E2E_MOCK_USER_LAST_NAME}`,
      emailAddresses: [
        { emailAddress: E2E_MOCK_USER_EMAIL, id: 'e2e_email_001' },
      ],
      primaryEmailAddress: {
        emailAddress: E2E_MOCK_USER_EMAIL,
        id: 'e2e_email_001',
      },
      publicMetadata: {},
    }),
    getUserList: async () => ({ data: [], totalCount: 0 }),
  },
});
