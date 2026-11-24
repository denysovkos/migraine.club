'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { use } from 'react';

import { UserProfileProvider } from '@/features/auth/UserProfileProvider';
import { clerkLocalization } from '@/libs/clerkLocalization';
import { AppConfig } from '@/utils/AppConfig';

export default function AuthLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = use(props.params);
  const { children } = props;
  let clerkLocale = clerkLocalization('en');
  let signInUrl = '/sign-in';
  let signUpUrl = '/sign-up';
  let dashboardUrl = '/dashboard';
  let afterSignOutUrl = '/';

  if (params.locale === 'fr' || params.locale === 'uk') {
    clerkLocale = clerkLocalization(params.locale);
  }

  if (params.locale !== AppConfig.defaultLocale) {
    signInUrl = `/${params.locale}${signInUrl}`;
    signUpUrl = `/${params.locale}${signUpUrl}`;
    dashboardUrl = `/${params.locale}${dashboardUrl}`;
    afterSignOutUrl = `/${params.locale}${afterSignOutUrl}`;
  }

  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      localization={clerkLocale}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      signInFallbackRedirectUrl={dashboardUrl}
      signUpFallbackRedirectUrl={dashboardUrl}
      afterSignOutUrl={afterSignOutUrl}
    >
      <UserProfileProvider currentLocale={params.locale}>
        {children}
      </UserProfileProvider>
    </ClerkProvider>
  );
}
