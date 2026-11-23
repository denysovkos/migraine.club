// src/app/[locale]/layout.tsx without the <html> and <body> elements, whose
// attributes are set on the existing document instead.
import { GoogleTagManager } from '@next/third-parties/google';
import { NextIntlClientProvider } from 'next-intl';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { useLayoutEffect } from 'react';
import { Outlet } from 'react-router';

import { DevMobileAuditGate } from '@/components/dev/DevMobileAuditGate';
import { ServiceWorkerRegister } from '@/components/pwa';
import { CookieBanner } from '@/features/consent';

import { setDocument } from './metadata';
import { currentLocale } from './shims/locale-state';

export function LocaleRoot({ locale }: { locale: string }) {
  // Called here, not at module level: the font's rules belong to the locale
  // routes only (see the next/font shim).
  const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
  useLayoutEffect(() => {
    setDocument({ lang: locale, htmlClass: inter.variable, bodyClass: 'bg-background font-sans text-foreground antialiased' });
  }, [locale, inter.variable]);
  return (
    <>
      <GoogleTagManager gtmId="G-0QRPP8GE79" />
      <Script
        src="https://migraine.club/umami/script.js"
        data-website-id="99b0c556-8f7b-4cd7-956c-454ed4dfb871"
        strategy="afterInteractive"
      />
      <NextIntlClientProvider locale={locale} messages={currentLocale().messages} timeZone="UTC">
        <DevMobileAuditGate>
          <Outlet />
          <CookieBanner />
          <ServiceWorkerRegister />
        </DevMobileAuditGate>
      </NextIntlClientProvider>
    </>
  );
}
