import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppConfig } from '@/utils/AppConfig';

/**
 * Localized sign-in path, matching the `signInUrl` passed to ClerkProvider in
 * `src/app/[locale]/(auth)/layout.tsx` (the default locale has no prefix).
 */
export function getSignInPath(locale: string): string {
  return locale === AppConfig.defaultLocale ? '/sign-in' : `/${locale}/sign-in`;
}

/**
 * Server-side guard for protected pages and layouts. Redirects signed-out
 * visitors to the localized sign-in page and returns the signed-in user id.
 *
 * `auth.protect()` would redirect to the unlocalized NEXT_PUBLIC_CLERK_SIGN_IN_URL,
 * so this uses `auth()` + `redirect()` to keep the locale.
 */
export async function requireUserOrRedirect(locale: string): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    redirect(getSignInPath(locale));
  }

  return userId;
}
