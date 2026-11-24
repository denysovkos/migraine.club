import { describe, expect, it } from 'vitest';

import { dropRedirects, sentryOptions, tunnelFor } from './sentry';

describe('sentry', () => {
  it('tunnels SaaS DSNs through /monitoring like @sentry/nextjs', () => {
    expect(tunnelFor('https://abc@o123.ingest.sentry.io/456')).toBe('/monitoring?o=123&p=456');
    expect(tunnelFor('https://abc@o123.ingest.de.sentry.io/456')).toBe('/monitoring?o=123&p=456&r=de');
    expect(tunnelFor('https://abc@sentry.example.com/1')).toBeUndefined();
    expect(tunnelFor(undefined)).toBeUndefined();
  });

  it('sends tunnelled events without credentials', () => {
    const opts = sentryOptions('https://abc@o1.ingest.sentry.io/2');

    expect(opts.tunnel).toBe('/monitoring?o=1&p=2');
    expect(opts.transportOptions).toEqual({ fetchOptions: { credentials: 'omit' } });
    expect(sentryOptions(undefined).tunnel).toBeUndefined();
  });

  it('drops redirects', () => {
    const event = { exception: { values: [{ value: 'x' }] } } as never;

    expect(dropRedirects(event, { originalException: new Response(null, { status: 307, headers: { Location: '/' } }) })).toBeNull();
    expect(dropRedirects({ exception: { values: [{ value: 'NEXT_REDIRECT' }] } } as never, {})).toBeNull();
    expect(dropRedirects(event, { originalException: new Error('x') })).toBe(event);
  });
});
