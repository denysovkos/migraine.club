'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { flushOutbox, setOutboxUser } from '@/libs/offline/outbox';
import { OfflineSyncIndicator } from './OfflineSyncIndicator';

const LAST_USER_KEY = 'mc-offline-user';

function readLastUser(): string | null {
  try {
    return window.localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function writeLastUser(userId: string | null) {
  try {
    if (userId) {
      window.localStorage.setItem(LAST_USER_KEY, userId);
    } else {
      window.localStorage.removeItem(LAST_USER_KEY);
    }
  } catch {
    // Storage blocked: offline capture then only works while Clerk is loaded.
  }
}

function clearCachedUserData() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.ready
    .then(reg => reg.active?.postMessage({ type: 'CLEAR_USER_DATA' }))
    .catch(() => {});
}

/**
 * Wires the offline outbox to the signed-in user and replays queued entries
 * whenever the connection comes back or the app returns to the foreground.
 *
 * Offline, Clerk's script can't load, so `useAuth` never reports a user. The
 * last user confirmed online is kept in localStorage for that case; a
 * confirmed sign-out or account switch clears it, along with the service
 * worker's cached pages and API responses for the previous user. Queued
 * entries are kept per user and only ever sent for their owner.
 */
export function OfflineSyncProvider({
  children,
  showIndicator = true,
}: {
  children: React.ReactNode;
  /** Off where the page reports offline saves itself (attack mode keeps the screen calm). */
  showIndicator?: boolean;
}) {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    const last = readLastUser();
    if (isLoaded) {
      const current = userId ?? null;
      if (last && last !== current) {
        clearCachedUserData();
      }
      writeLastUser(current);
      setOutboxUser(current);
    } else {
      // Not loaded yet, or can't load while offline: trust the last known user.
      setOutboxUser(last);
    }
    void flushOutbox();
  }, [isLoaded, userId]);

  useEffect(() => {
    const flush = () => {
      if (navigator.onLine !== false) {
        void flushOutbox();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flush();
      }
    };
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    // Safety net for flaky connections where `online` never fires.
    const interval = window.setInterval(flush, 60_000);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      {children}
      {showIndicator && <OfflineSyncIndicator />}
    </>
  );
}
