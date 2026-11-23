// Clerk's handshake, for the browser.
//
// Next ran clerkMiddleware on every page load: when the session token in
// the __session cookie had expired (it lives about a minute) or was older
// than the client's last update (__client_uat), Clerk refreshed it before
// the page rendered, so the page's API calls carried a valid token. The
// SPA's pages call the API as soon as they mount, before clerk-js has
// refreshed the cookie, and those calls would get 401. This guard holds a
// same-origin /api/ request until clerk-js has a fresh token in the cookie,
// then sends it once, unchanged. Nothing is retried, so a write is never
// sent twice.

type ClerkLike = {
  loaded?: boolean;
  session?: { getToken: (options?: { skipCache?: boolean }) => Promise<string | null> } | null;
};

/** How long a request waits for clerk-js before it goes out as it is. */
const CLERK_WAIT_MS = 10_000;

function parseCookies(cookieString: string): [string, string][] {
  return cookieString.split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  });
}

function jwtPayload(token: string): { exp?: number; iat?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) {
      return null;
    }
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/**
 * Whether Clerk would have handshaken: an active client (__client_uat > 0)
 * without a session token that is unexpired and issued after the client's
 * last update. Cookies may carry the instance suffix (__session_<suffix>).
 */
export function needsRefresh(cookieString: string, nowSeconds: number): boolean {
  const cookies = parseCookies(cookieString);
  const clientUat = Math.max(0, ...cookies
    .filter(([name]) => /^__client_uat(?:_.+)?$/.test(name))
    .map(([, value]) => Number(value) || 0));
  if (!clientUat) {
    return false;
  }
  const sessions = cookies.filter(([name]) => /^__session(?:_.+)?$/.test(name)).map(([, value]) => value);
  return !sessions.some((token) => {
    const payload = jwtPayload(token);
    return !!payload && (payload.exp ?? 0) > nowSeconds + 5 && (payload.iat ?? 0) >= clientUat;
  });
}

function loadedClerk(): ClerkLike | undefined {
  const clerk = (globalThis as { Clerk?: ClerkLike }).Clerk;
  return clerk?.loaded ? clerk : undefined;
}

function waitForClerk(timeoutMs: number): Promise<ClerkLike | undefined> {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      const clerk = loadedClerk();
      if (clerk || Date.now() - started >= timeoutMs) {
        resolve(clerk);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

let pending: Promise<void> | null = null;

/** Asks clerk-js for a fresh session token, which it writes to the cookie. */
export function refreshSession(timeoutMs = CLERK_WAIT_MS): Promise<void> {
  pending ??= (async () => {
    try {
      const clerk = await waitForClerk(timeoutMs);
      if (clerk?.session && needsRefresh(document.cookie, Date.now() / 1000)) {
        await clerk.session.getToken({ skipCache: true }).catch(() => null);
      }
    } finally {
      pending = null;
    }
  })();
  return pending;
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** Holds API requests until the session cookie is fresh. */
export function installSessionRefresh(timeoutMs = CLERK_WAIT_MS) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isSameOriginApi(input) && needsRefresh(document.cookie, Date.now() / 1000)) {
      await refreshSession(timeoutMs);
    }
    return nativeFetch(input, init);
  };
}
