import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSessionRefresh, needsRefresh } from './sessionRefresh';

const NOW = 1_800_000_000;

function jwt(payload: Record<string, number>): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

describe('needsRefresh', () => {
  const fresh = jwt({ iat: NOW - 10, exp: NOW + 50 });
  const expired = jwt({ iat: NOW - 120, exp: NOW - 60 });

  it('is false when signed out or Clerk never ran', () => {
    expect(needsRefresh('', NOW)).toBe(false);
    expect(needsRefresh('__client_uat=0', NOW)).toBe(false);
    expect(needsRefresh(`__session=${expired}`, NOW)).toBe(false);
  });

  it('is false for an unexpired token issued after the client update', () => {
    expect(needsRefresh(`__client_uat=${NOW - 60}; __session=${fresh}`, NOW)).toBe(false);
    expect(needsRefresh(`__client_uat_AbC=${NOW - 60}; __session_AbC=${fresh}`, NOW)).toBe(false);
  });

  it('is true where Clerk would have handshaken', () => {
    // Expired, or about to.
    expect(needsRefresh(`__client_uat=${NOW - 600}; __session=${expired}`, NOW)).toBe(true);
    expect(needsRefresh(`__client_uat=${NOW - 600}; __session=${jwt({ iat: NOW - 58, exp: NOW + 2 })}`, NOW)).toBe(true);
    // Active client without a session token.
    expect(needsRefresh(`__client_uat=${NOW - 600}`, NOW)).toBe(true);
    // Token issued before the client was last updated.
    expect(needsRefresh(`__client_uat=${NOW}; __session=${fresh}`, NOW)).toBe(true);
    // Not a JWT.
    expect(needsRefresh(`__client_uat=${NOW - 600}; __session=garbage`, NOW)).toBe(true);
  });
});

describe('installSessionRefresh', () => {
  let nativeFetch: ReturnType<typeof vi.fn>;
  let cookie = '';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    cookie = '';
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie);
    nativeFetch = vi.fn(async () => new Response('{}'));
    window.fetch = nativeFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as { Clerk?: unknown }).Clerk;
  });

  it('holds an API call until clerk-js has written a fresh token, then sends it once', async () => {
    cookie = `__client_uat=${NOW - 600}; __session=${jwt({ iat: NOW - 120, exp: NOW - 60 })}`;
    const order: string[] = [];
    const getToken = vi.fn(async () => {
      order.push('refresh');
      cookie = `__client_uat=${NOW - 600}; __session=${jwt({ iat: NOW, exp: NOW + 60 })}`;
      return 'token';
    });
    nativeFetch.mockImplementation(async () => {
      order.push('fetch');
      return new Response('{}');
    });
    (globalThis as { Clerk?: unknown }).Clerk = { loaded: true, session: { getToken } };
    installSessionRefresh(1000);

    await window.fetch('/api/preventives/due');
    await window.fetch('/api/diary/today');

    expect(order).toEqual(['refresh', 'fetch', 'fetch']);
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('sends right away when the token is fresh, and leaves other requests alone', async () => {
    cookie = `__client_uat=${NOW - 600}; __session=${jwt({ iat: NOW - 10, exp: NOW + 50 })}`;
    const getToken = vi.fn();
    (globalThis as { Clerk?: unknown }).Clerk = { loaded: true, session: { getToken } };
    installSessionRefresh(1000);

    await window.fetch('/api/episodes');
    cookie = `__client_uat=${NOW - 600}`;
    await window.fetch('/assets/app.js');
    await window.fetch('https://other.example/api/x');

    expect(getToken).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(3);
  });

  it('gives up waiting for clerk-js and sends the request as it is', async () => {
    vi.useRealTimers();
    cookie = `__client_uat=${NOW - 600}`;
    installSessionRefresh(120);

    await window.fetch('/api/episodes', { method: 'POST', body: 'x' });

    expect(nativeFetch).toHaveBeenCalledWith('/api/episodes', { method: 'POST', body: 'x' });
  });
});
