// src/instrumentation-client.ts with what @sentry/nextjs added to it:
// the environment, events tunnelled through /monitoring (tunnelRoute in the
// old next.config.mjs; the Go server forwards them to Sentry), and redirects
// not reported as errors.
import type { BrowserOptions } from '@sentry/react';
import * as Sentry from '@sentry/react';

/** @sentry/nextjs's applyTunnelRouteOption for a Sentry SaaS DSN. */
export function tunnelFor(dsn: string | undefined, route = '/monitoring'): string | undefined {
  const match = dsn ? /^https?:\/\/[^@]+@(o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io)\/(\d+)$/.exec(dsn) : null;
  if (!match) {
    return undefined;
  }
  const [, , orgId, region, projectId] = match;
  return `${route}?o=${orgId}&p=${projectId}${region ? `&r=${region}` : ''}`;
}

/** A redirect thrown for the router (redirect() in a page) is no error. */
export function dropRedirects(event: Sentry.ErrorEvent, hint: Sentry.EventHint): Sentry.ErrorEvent | null {
  const original = hint?.originalException;
  if (original instanceof Response && original.status >= 300 && original.status < 400) {
    return null;
  }
  return event.exception?.values?.[0]?.value === 'NEXT_REDIRECT' ? null : event;
}

export function sentryOptions(dsn: string | undefined): BrowserOptions {
  const tunnel = tunnelFor(dsn);
  return {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1,
    debug: false,
    // This app handles health data: no user info, cookies or bodies.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    ignoreSpans: [/^\/404$/],
    ...(tunnel ? { tunnel, transportOptions: { fetchOptions: { credentials: 'omit' } } } : {}),
    beforeSend: dropRedirects,
  } as BrowserOptions;
}

export function initSentry() {
  Sentry.init(sentryOptions(import.meta.env.NEXT_PUBLIC_SENTRY_DSN as string | undefined));
}
