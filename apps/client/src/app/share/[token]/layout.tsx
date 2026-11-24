import { setRequestLocale } from 'next-intl/server';

import { ShareIntlProvider } from '@/features/share/ShareIntlProvider';

import '@/styles/global.css';

/**
 * Root layout for the public share page.
 * Minimal layout with no navigation or tracking.
 * Supports dynamic language switching via client-side provider.
 */
export default function ShareRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set default locale for server components in this route segment
  setRequestLocale('en');

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans antialiased">
        <ShareIntlProvider>
          {children}
        </ShareIntlProvider>
      </body>
    </html>
  );
}
