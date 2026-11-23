// @/libs/Env in the SPA. NEXT_PUBLIC_* values are inlined at build time, as
// Next did; server flags the pages read come from the config the Go server
// writes into index.html.
declare global {
  // eslint-disable-next-line vars-on-top
  var __APP_CONFIG__: { enableInsights?: boolean } | undefined;
}

export const Env = {
  NEXT_PUBLIC_APP_URL: import.meta.env.NEXT_PUBLIC_APP_URL as string | undefined,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: import.meta.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: import.meta.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: import.meta.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string | undefined,
  NEXT_PUBLIC_E2E_MOCK_AUTH: import.meta.env.NEXT_PUBLIC_E2E_MOCK_AUTH as string | undefined,
  get ENABLE_F39_INSIGHTS() {
    return Boolean(globalThis.__APP_CONFIG__?.enableInsights);
  },
};
