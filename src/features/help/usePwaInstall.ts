'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function usePwaInstall() {
  const [installed, setInstalled] = useState(false);
  const [bipEvent, setBipEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const canInstall = useMemo(() => !installed && bipEvent !== null, [installed, bipEvent]);

  const refreshInstalled = useCallback(() => {
    setInstalled(isStandalone());
  }, []);

  useEffect(() => {
    refreshInstalled();

    const mql = window.matchMedia('(display-mode: standalone)');
    const onChange = () => refreshInstalled();

    // MediaQueryList supports addEventListener/removeEventListener in modern browsers.
    // The deprecated addListener/removeListener fallback is intentionally omitted because
    // TypeScript's DOM lib models it as always supported (making the fallback unreachable).
    mql.addEventListener('change', onChange);

    window.addEventListener('appinstalled', onChange);
    document.addEventListener('visibilitychange', onChange);

    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('appinstalled', onChange);
      document.removeEventListener('visibilitychange', onChange);
    };
  }, [refreshInstalled]);

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      // Store for later; must be triggered via a user gesture.
      e.preventDefault();
      setBipEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!bipEvent) {
      return;
    }

    try {
      await bipEvent.prompt();
      await bipEvent.userChoice;
    } finally {
      setBipEvent(null);
      refreshInstalled();
    }
  }, [bipEvent, refreshInstalled]);

  return {
    installed,
    canInstall,
    promptInstall,
  };
}
