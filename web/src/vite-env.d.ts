/// <reference types="vite/client" />

/* eslint-disable ts/consistent-type-definitions -- declaration merging with Vite's ImportMetaEnv */
interface ImportMetaEnv {
  readonly NEXT_PUBLIC_APP_URL?: string;
  readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  readonly NEXT_PUBLIC_CLERK_SIGN_IN_URL: string;
  readonly NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
  readonly NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  readonly NEXT_PUBLIC_E2E_MOCK_AUTH?: string;
  readonly VITE_E2E_MOCK_USER_ID: string;
}
