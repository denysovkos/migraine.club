// Root layouts outside the locale tree render their own <html> and <body>;
// here their attributes go on the existing document instead.
import type { ReactNode } from 'react';
import { useLayoutEffect } from 'react';

import { ShareIntlProvider } from '@/features/share/ShareIntlProvider';

import { setDocument } from '../metadata';

function useDocument(bodyClass: string) {
  useLayoutEffect(() => {
    setDocument({ lang: 'en', htmlClass: null, bodyClass });
  }, [bodyClass]);
}

/** src/app/admin/{doctor-verifications,feature-requests}/layout.tsx */
export function AdminLayout(props: { children: ReactNode }) {
  useDocument('min-h-screen bg-background font-sans text-foreground antialiased');
  return <>{props.children}</>;
}

/** src/app/share/[token]/layout.tsx */
export function ShareLayout(props: { children: ReactNode }) {
  useDocument('min-h-screen bg-slate-50 font-sans antialiased');
  return <ShareIntlProvider>{props.children}</ShareIntlProvider>;
}
