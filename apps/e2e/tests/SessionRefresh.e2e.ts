import { Buffer } from 'node:buffer';

import { expect, test } from './_fixtures';

/**
 * Clerk's handshake, in the browser (apps/client/spa/sessionRefresh.ts): with an
 * active Clerk client but an expired session token in the cookie, the
 * dashboard's API calls wait until clerk-js has written a fresh token, so
 * none of them goes out with the stale one. The e2e server signs every
 * request in regardless, so this checks the order of events in the page.
 */

function jwt(payload: Record<string, number>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

test('API calls wait for a fresh session token when the cookie has expired', async ({ page, context, baseURL }) => {
  const now = Math.floor(Date.now() / 1000);
  const fresh = jwt({ iat: now, exp: now + 3600 });
  await context.addCookies([
    { name: '__client_uat', value: String(now - 3600), url: baseURL! },
    { name: '__session', value: jwt({ iat: now - 600, exp: now - 540 }), url: baseURL! },
  ]);
  // clerk-js stand-in: loads after a moment, and its refresh writes a fresh
  // token to the cookie as the real one does.
  await context.addInitScript(({ fresh }) => {
    const events: string[] = [];
    (window as any).__events = events;
    setTimeout(() => {
      (window as any).Clerk = {
        loaded: true,
        session: {
          getToken: async () => {
            events.push('refresh');
            document.cookie = `__session=${fresh}; path=/`;
            return fresh;
          },
        },
      };
    }, 300);
  }, { fresh });

  const stale = jwt({ iat: now - 600, exp: now - 540 });
  const cookieHeaders: Promise<string>[] = [];
  const onRequest = (req: import('@playwright/test').Request) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) {
      cookieHeaders.push(req.allHeaders().then(h => h.cookie ?? '', () => ''));
    }
  };
  page.on('request', onRequest);

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // A card filled from the API: the dashboard's requests have gone out.
  await expect(page.getByRole('listitem').filter({ hasText: 'Topiramate (E2E)' }).first()).toBeVisible();

  page.off('request', onRequest);
  const sent = await Promise.all(cookieHeaders);

  // Requests the service worker answers show up twice: page to worker
  // (no cookies) and worker to network (with them). Those with cookies
  // must all carry the refreshed token; none may carry the stale one.
  const withCookies = sent.filter(c => c.includes('__session='));

  expect(withCookies.length).toBeGreaterThan(0);
  expect(sent.filter(c => c.includes(stale))).toEqual([]);
  expect(withCookies.every(c => c.includes(fresh))).toBe(true);
  expect(await page.evaluate(() => (window as any).__events)).toEqual(['refresh']);
});

test('a fresh session token sends API calls right away', async ({ page, context, baseURL }) => {
  const now = Math.floor(Date.now() / 1000);
  await context.addCookies([
    { name: '__client_uat', value: String(now - 3600), url: baseURL! },
    { name: '__session', value: jwt({ iat: now - 10, exp: now + 50 }), url: baseURL! },
  ]);
  await context.addInitScript(() => {
    (window as any).__refreshed = false;
    (window as any).Clerk = { loaded: true, session: { getToken: async () => {
      (window as any).__refreshed = true;
      return null;
    } } };
  });

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  expect(await page.evaluate(() => (window as any).__refreshed)).toBe(false);
});
