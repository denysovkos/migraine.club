import type { Metadata, Viewport } from 'next';

import { GoogleTagManager } from '@next/third-parties/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { DevMobileAuditGate } from '@/components/dev/DevMobileAuditGate';

import { ServiceWorkerRegister } from '@/components/pwa';
import { CookieBanner } from '@/features/consent';
import { AllLocales } from '@/utils/AppConfig';
import { getBaseUrl } from '@/utils/Helpers';
import '@/styles/global.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Migrennity',
  },
  icons: [
    {
      rel: 'apple-touch-icon',
      url: '/apple-touch-icon.png',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      url: '/favicon-32x32.png',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      url: '/favicon-16x16.png',
    },
    {
      rel: 'icon',
      url: '/favicon.ico',
    },
  ],
  openGraph: {
    type: 'website',
    siteName: 'Migrennity',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

// Next.js requires themeColor to be exported via viewport/generateViewport (not metadata).
export const viewport: Viewport = {
  themeColor: '#1e1b4b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export function generateStaticParams() {
  return AllLocales.map(locale => ({ locale }));
}

export default async function RootLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  // Using internationalization in Client Components
  const messages = await getMessages();

  // The `suppressHydrationWarning` in <html> is used to prevent hydration errors caused by `next-themes`.
  // Solution provided by the package itself: https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app

  // The `suppressHydrationWarning` attribute in <body> is used to prevent hydration errors caused by Sentry Overlay,
  // which dynamically adds a `style` attribute to the body tag.
  return (
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <GoogleTagManager gtmId="G-0QRPP8GE79" />
      <Script
        src="https://migraine.club/umami/script.js"
        data-website-id="99b0c556-8f7b-4cd7-956c-454ed4dfb871"
        strategy="afterInteractive"
      />
      <body className="bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          timeZone="UTC"
        >
          <DevMobileAuditGate>
            {props.children}
            <CookieBanner />
            <ServiceWorkerRegister />
          </DevMobileAuditGate>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
