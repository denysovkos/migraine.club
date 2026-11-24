// Sentry is a chunk of its own, loaded after the first render (main.tsx),
// so the page does not wait for it. Errors are handed to it once loaded.
export function reportError(error: unknown): Promise<void> {
  return import('@sentry/react').then((Sentry) => {
    Sentry.captureException(error);
  });
}
