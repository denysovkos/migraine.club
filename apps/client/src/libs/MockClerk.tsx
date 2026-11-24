/**
 * Mock for `@clerk/nextjs` used during Playwright e2e tests.
 *
 * Wired via a webpack alias in next.config.mjs when `E2E_MOCK_AUTH=true`.
 * Never bundled into production builds.
 */

/* eslint-disable react-refresh/only-export-components, react/no-unnecessary-use-prefix */
'use client';

import type { ReactNode } from 'react';

import {
  E2E_MOCK_USER_EMAIL,
  E2E_MOCK_USER_FIRST_NAME,
  E2E_MOCK_USER_ID_DEFAULT,
  E2E_MOCK_USER_LAST_NAME,
} from './E2EAuth';

const MOCK_USER = {
  id: E2E_MOCK_USER_ID_DEFAULT,
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
  emailAddresses: [
    { emailAddress: E2E_MOCK_USER_EMAIL, id: 'e2e_email_001' },
  ],
  publicMetadata: {},
  privateMetadata: {},
  unsafeMetadata: {},
};

export const useUser = () => ({
  isLoaded: true,
  isSignedIn: true,
  user: MOCK_USER as any,
});

export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: true,
  userId: E2E_MOCK_USER_ID_DEFAULT,
  sessionId: 'e2e_session_001',
  orgId: null,
  orgRole: null,
  orgSlug: null,
  signOut: async () => {},
  getToken: async () => 'e2e_token',
});

export const useClerk = () => ({
  signOut: async () => {},
  openSignIn: () => {},
  openSignUp: () => {},
  user: MOCK_USER as any,
});

export const useSession = () => ({
  isLoaded: true,
  isSignedIn: true,
  session: { id: 'e2e_session_001' } as any,
});

export const ClerkProvider = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);

export const SignedIn = ({ children }: { children: ReactNode }) => <>{children}</>;
export const SignedOut = () => null;

export const SignIn = () => <div data-testid="mock-sign-in" />;
export const SignUp = () => <div data-testid="mock-sign-up" />;
export const UserProfile = () => <div data-testid="mock-user-profile" />;
export const UserButton = () => <div data-testid="mock-user-button" />;

export const Show = ({
  children,
  when,
}: {
  children: ReactNode;
  when: 'signed-in' | 'signed-out';
}) => (when === 'signed-in' ? <>{children}</> : null);

export const Protect = ({ children }: { children: ReactNode }) => <>{children}</>;

export const RedirectToSignIn = () => null;
export const RedirectToSignUp = () => null;
export const RedirectToUserProfile = () => null;
