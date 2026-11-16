/* eslint-disable no-restricted-globals, no-console, no-undef */
/**
 * Migrennity Service Worker
 * Handles push notifications and basic caching for PWA functionality.
 *
 * This SW is intentionally minimal to avoid interfering with auth/session cookies.
 * Caching is limited to static assets only.
 */

const SW_VERSION = '1.0.0';
const CACHE_NAME = `migrennity-sw-v${SW_VERSION}`;

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
            .filter(name => name !== CACHE_NAME && name.startsWith('migrennity-sw-'))
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

// Fetch event - network-first strategy to avoid breaking auth
// Only use cache for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache GET requests for static assets
  if (event.request.method !== 'GET') {
    return;
  }

  // Check if this is a static asset we should cache
  const isStaticAsset = STATIC_ASSETS.includes(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request);
        })
        .catch(() => {
          // Network failed and not in cache
          return new Response('Offline', { status: 503 });
        }),
    );
  }
  // For all other requests, let them pass through normally (network-first)
  // This ensures auth/session cookies work correctly
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
});
