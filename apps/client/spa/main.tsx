import type { Metadata } from './metadata';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createBrowserRouter, RouterProvider } from 'react-router';
import { applyMetadata } from './metadata';
import { routes } from './routes';
import { installSessionRefresh } from './sessionRefresh';
import '@/styles/global.css';

installSessionRefresh();
// Sentry (about half the size of the app's own bundle) loads in a chunk of
// its own once the page has started, when a DSN is configured.
if (import.meta.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import('./sentry').then(m => m.initSentry());
}

const router = createBrowserRouter(routes());

router.subscribe((state) => {
  if (state.navigation.state !== 'idle') {
    return;
  }
  const chain = state.matches.map(m => (state.loaderData[m.route.id] as { metadata?: Metadata } | null)?.metadata);
  applyMetadata(chain);
});

// React renders straight into <body>, like the Next document did.
createRoot(document.body).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
