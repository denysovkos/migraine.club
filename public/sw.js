/* eslint-disable no-restricted-globals, no-console, no-undef */
/**
 * Migrennity Service Worker
 * Handles push notifications and basic caching for PWA functionality.
 *
 * Offline support (see docs/OFFLINE_LOGGING.md):
 * - Hashed Next.js build assets are cached on first use (cache-first).
 * - Dashboard pages and a short allowlist of read APIs the logging forms need
 *   are cached network-first, so the app still opens and the forms still
 *   populate without a connection. These caches hold the signed-in user's
 *   data and are wiped on sign-out or account switch (CLEAR_USER_DATA).
 * - Entries logged offline sit in the IndexedDB outbox (src/libs/offline) and
 *   are replayed here through Background Sync where the browser supports it.
 *
 * Writes and auth requests are never cached or intercepted.
 */

const SW_VERSION = '1.2.0';
const CACHE_NAME = `migrennity-sw-v${SW_VERSION}`;
// Build assets are content-hashed, so this cache survives SW upgrades.
const NEXT_STATIC_CACHE = 'migrennity-next-static';
// User data: cleared on sign-out / account switch.
const PAGES_CACHE = 'migrennity-user-pages';
const API_CACHE = 'migrennity-user-api';
const USER_CACHES = [PAGES_CACHE, API_CACHE];
const KEEP_CACHES = new Set([CACHE_NAME, NEXT_STATIC_CACHE, ...USER_CACHES]);

// Dashboard routes and attack mode, with or without a non-default locale prefix (as-needed).
const APP_PAGE_RE = /^\/(?:(?:fr|uk)\/)?(?:dashboard|quick\/attack)(?:\/|$)/;

// Read endpoints the quick-log flows depend on. Network-first.
// consent + profile gate the dashboard itself: without them it would show the
// consent modal (or nothing) when opened offline.
const CACHEABLE_API_PATHS = [
  '/api/user/consent',
  '/api/user/profile',
  '/api/user-medications',
  '/api/quick-add/suggestions',
  '/api/diary/today',
  '/api/episodes/recent',
  '/api/factors/options',
  '/api/moh-status',
];

// Offline outbox. Must match src/libs/offline/outboxStore.ts and outbox.ts.
const OUTBOX_DB = 'mc-offline';
const OUTBOX_DB_VERSION = 1;
const OUTBOX_STORE = 'outbox';
const OUTBOX_CHANNEL = 'mc-outbox';
const OUTBOX_SYNC_TAG = 'mc-outbox-sync';
// Mirrors REPLAY_ATTEMPT_TIMEOUT_MS in src/libs/offline/outbox.ts: a request
// that hangs must not hold the outbox lock forever.
const REPLAY_ATTEMPT_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, init, ms) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) {
        controller.abort();
      }
      reject(new TypeError('Replay request timed out'));
    }, ms);
  });
  const request = fetch(url, controller ? { ...init, signal: controller.signal } : init);
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}
const MAX_RETRY_ATTEMPTS = 8;

// Static assets to cache (conservative list)
const STATIC_ASSETS = [
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/favicon.ico',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing service worker v${SW_VERSION}`);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      }),
  );
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating service worker v${SW_VERSION}`);

  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => name.startsWith('migrennity-') && !KEEP_CACHES.has(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }),
        ),
      ),
      // Claim all clients immediately
      self.clients.claim(),
    ]),
  );
});

// Fetch event. Only GETs are ever answered from cache; writes go straight to
// the network (the page queues them itself when that fails).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request))
        .catch(() => new Response('Offline', { status: 503 })),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, NEXT_STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate' && APP_PAGE_RE.test(url.pathname)) {
    event.respondWith(networkFirstPage(request, url));
    return;
  }

  if (CACHEABLE_API_PATHS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, API_CACHE));
  }
  // Everything else passes through untouched (auth, RSC payloads, other APIs).
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function networkFirstPage(request, url) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    // Don't cache redirects (e.g. to sign-in) or errors.
    if (response.ok && !response.redirected) {
      cache.put(url.pathname, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(url.pathname);
    if (cached) {
      return cached;
    }
    // Unvisited page: fall back to the dashboard home in the same locale,
    // which carries the quick-log sheet.
    const prefix = url.pathname.match(/^\/(fr|uk)\//)?.[0] ?? '/';
    const home = await cache.match(`${prefix}dashboard`);
    if (home) {
      return home;
    }
    return offlineFallbackPage();
  }
}

function offlineFallbackPage() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a}main{max-width:22rem;padding:24px;text-align:center}button{margin-top:16px;padding:12px 20px;border-radius:12px;border:0;background:#6d28d9;color:#fff;font-size:16px}@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}}</style></head>
<body><main><h1>You're offline</h1><p>Open the app once while connected so it can be used offline next time. Anything you already logged on this device is kept and will sync automatically.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---------------------------------------------------------------------------
// Offline outbox replay (Background Sync). Mirrors flushOutbox() in
// src/libs/offline/outbox.ts, but replays every signed-in user's entries
// because a service worker can't tell who is signed in. The server refuses
// entries whose X-Offline-User doesn't match the session, and those stay
// queued for their owner.

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OUTBOX_STORE)) {
        req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function outboxOp(mode, fn) {
  const db = await openOutboxDb();
  try {
    const tx = db.transaction(OUTBOX_STORE, mode);
    const result = await idbRequest(fn(tx.objectStore(OUTBOX_STORE)));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function classifyResponse(status, code) {
  if (status >= 200 && status < 300) {
    return 'done';
  }
  if (status === 401) {
    return 'auth';
  }
  if (status === 409 && code === 'OFFLINE_USER_MISMATCH') {
    return 'wrong_user';
  }
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') {
    return 'retry';
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return 'retry';
  }
  return 'failed';
}

async function replayOutbox() {
  const all = await outboxOp('readonly', s => s.getAll());
  const pending = all.filter(i => i.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const blockedUsers = new Set();
  let changed = false;
  let networkDown = false;

  for (const item of pending) {
    if (blockedUsers.has(item.userId)) {
      continue;
    }
    let outcome;
    let errorText = null;
    try {
      const res = await fetchWithTimeout(item.url, {
        method: item.method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': item.id,
          'X-Offline-User': item.userId,
        },
        body: item.body,
      }, REPLAY_ATTEMPT_TIMEOUT_MS);
      const data = res.ok ? null : await res.json().catch(() => null);
      outcome = classifyResponse(res.status, data && data.code);
      errorText = (data && data.error) || (res.ok ? null : `HTTP ${res.status}`);
    } catch {
      networkDown = true;
      break;
    }

    if (outcome === 'done') {
      await outboxOp('readwrite', s => s.delete(item.id));
      changed = true;
      continue;
    }
    if (outcome === 'failed') {
      await outboxOp('readwrite', s => s.put({ ...item, status: 'failed', attempts: item.attempts + 1, lastError: errorText }));
      changed = true;
      continue;
    }
    if (outcome === 'retry') {
      const attempts = item.attempts + 1;
      const status = attempts >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending';
      await outboxOp('readwrite', s => s.put({ ...item, status, attempts, lastError: errorText }));
      changed = true;
      if (status === 'failed') {
        continue;
      }
    }
    // retry / auth / wrong_user: keep this user's remaining entries in order.
    blockedUsers.add(item.userId);
  }

  if (changed) {
    try {
      const ch = new BroadcastChannel(OUTBOX_CHANNEL);
      ch.postMessage({ type: 'changed' });
      ch.close();
    } catch {
      // ignore
    }
  }

  // Throwing makes the browser retry the sync later with backoff.
  if (networkDown || blockedUsers.size > 0) {
    throw new Error('Outbox not fully synced');
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== OUTBOX_SYNC_TAG) {
    return;
  }
  const run = () => replayOutbox();
  event.waitUntil(
    self.navigator && self.navigator.locks
      ? self.navigator.locks.request(OUTBOX_CHANNEL, run)
      : run(),
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = {
    title: 'Migrennity',
    body: 'You have a new notification',
    icon: '/android-chrome-192x192.png',
    badge: '/android-icon-72x72.png',
    url: '/',
  };

  // Try to parse push data
  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        icon: payload.icon || data.icon,
        badge: payload.badge || data.badge,
        url: payload.url || payload.data?.url || data.url,
        ...payload,
      };
    } catch (e) {
      console.error('[SW] Failed to parse push data:', e);
      // Try as text
      try {
        data.body = event.data.text();
      } catch (textError) {
        console.error('[SW] Failed to read push data as text:', textError);
      }
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [100, 50, 100],
    data: {
      url: data.url,
      dateOfArrival: Date.now(),
    },
    actions: data.actions || [],
    tag: data.tag || 'migrennity-notification',
    renotify: data.renotify || false,
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options),
  );
});

// Notification click event - handle notification interactions
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');

  event.notification.close();

  const data = event.notification.data || {};
  const urlToOpen = data.url || '/';
  const action = event.action;

  // ────────────────────────────────────────────────────────────
  // Programs module: action buttons map to API calls so the user
  // doesn't have to open the app on Android/desktop. iOS Safari
  // ignores actions; users tap the body and land on the deep-link.
  // ────────────────────────────────────────────────────────────
  if (action && data.programAction) {
    event.waitUntil((async () => {
      try {
        const res = await fetch(data.programAction.endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(data.programAction.body || {}),
            action,
          }),
        });
        if (!res.ok) {
          // Fallback: open the deep-link so the user can finish in-app.
          if (data.deepLink && self.clients.openWindow) {
            await self.clients.openWindow(data.deepLink);
          }
        }
      } catch (e) {
        console.error('[SW] Program action fetch failed:', e);
        if (data.deepLink && self.clients.openWindow) {
          await self.clients.openWindow(data.deepLink);
        }
      }
    })());
    return;
  }

  // Body tap → focus existing window or open the deep-link / fallback url.
  const target = data.deepLink || urlToOpen;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && 'focus' in client) {
            return client.focus().then((focusedClient) => {
              if ('navigate' in focusedClient) {
                return focusedClient.navigate(target);
              }
              return focusedClient;
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(target);
        }
        return null;
      }),
  );
});

// Notification close event - optional analytics/cleanup
self.addEventListener('notificationclose', (_event) => {
  console.log('[SW] Notification closed without interaction');
});

// Push subscription change event - handle subscription renewals
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed');

  event.waitUntil(
    // Re-subscribe with the same options
    self.registration.pushManager.subscribe(event.oldSubscription?.options || {
      userVisibleOnly: true,
    })
      .then((subscription) => {
        // Notify the server about the new subscription
        // This requires the server endpoint to be available
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))),
              auth: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth')))),
            },
            expirationTime: subscription.expirationTime,
          }),
        });
      })
      .catch((error) => {
        console.error('[SW] Failed to re-subscribe:', error);
      }),
  );
});

// Message event - handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Sent by the app on sign-out or account switch: drop cached pages and API
  // responses that belong to the previous user.
  if (event.data && event.data.type === 'CLEAR_USER_DATA') {
    event.waitUntil(Promise.all(USER_CACHES.map(name => caches.delete(name))));
  }
});
