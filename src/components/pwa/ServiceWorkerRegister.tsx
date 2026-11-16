'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegister - Registers the service worker for PWA functionality.
 *
 * This component should be mounted once in the root layout. It handles:
 * - Service worker registration
 * - Update detection and automatic activation
 * - Graceful degradation if SW is not supported
 *
 * The component renders nothing - it only performs side effects.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Only register service worker in browser environment
    if (typeof window === 'undefined') {
      return undefined;
    }

    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('[PWA] Service workers not supported in this browser');
      }
      return undefined;
    }

    let updateInterval: NodeJS.Timeout | null = null;

    const registerServiceWorker = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('[PWA] Service worker registered with scope:', registration.scope);
        }

        // Check for updates periodically (every hour)
        const checkForUpdates = (): void => {
          registration.update().catch((error) => {
            if (process.env.NODE_ENV === 'development') {
              console.error('[PWA] Failed to check for SW updates:', error);
            }
          });
        };

        // Check for updates every hour
        updateInterval = setInterval(checkForUpdates, 60 * 60 * 1000);

        // Handle service worker updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;

          if (!newWorker) {
            return;
          }

          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('[PWA] New service worker found, installing...');
          }

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker is installed and there's an existing one
              if (process.env.NODE_ENV === 'development') {
                // eslint-disable-next-line no-console
                console.log('[PWA] New service worker installed, will activate on next reload');
              }

              // Optionally: Tell the new SW to skip waiting and activate immediately
              // This provides seamless updates without requiring user action
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Handle controller change (when new SW takes over)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('[PWA] New service worker activated');
          }
        });
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[PWA] Service worker registration failed:', error);
        }
      }
    };

    // Register service worker when the page loads
    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    // Cleanup function
    return () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      window.removeEventListener('load', registerServiceWorker);
    };
  }, []);

  // This component renders nothing
  return null;
}
