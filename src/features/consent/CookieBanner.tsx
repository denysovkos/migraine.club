'use client';

import { Cookie, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { isAttackModePath } from '@/features/attackMode/attackModeLogic';

const COOKIE_PREFS_KEY = 'migrennity_cookie_prefs';

export type CookiePreferences = {
  essential: boolean; // Always true
  analytics: boolean;
  timestamp: number;
};

// eslint-disable-next-line react-refresh/only-export-components
export function getCookiePreferences(): CookiePreferences | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = localStorage.getItem(COOKIE_PREFS_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as CookiePreferences;
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function setCookiePreferences(prefs: CookiePreferences): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(COOKIE_PREFS_KEY, JSON.stringify(prefs));
}

// eslint-disable-next-line react-refresh/only-export-components
export function hasAnalyticsConsent(): boolean {
  const prefs = getCookiePreferences();
  return prefs?.analytics ?? false;
}

export function CookieBanner() {
  const t = useTranslations('CookieBanner');
  const [isVisible, setIsVisible] = useState(false);
  // No bright panel over the low-stimulus attack screen. Without a stored
  // choice analytics stay off, and the banner shows on the next page instead.
  const deferred = isAttackModePath(usePathname());

  useEffect(() => {
    if (deferred) {
      return undefined;
    }
    // Check if user has already made a choice
    const prefs = getCookiePreferences();
    if (!prefs) {
      // Small delay to avoid flash on page load
      const timer = setTimeout(setIsVisible, 500, true);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [deferred]);

  const handleAcceptAll = () => {
    setCookiePreferences({
      essential: true,
      analytics: true,
      timestamp: Date.now(),
    });
    setIsVisible(false);
    // Dispatch event so analytics can initialize
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', { detail: { analytics: true } }));
  };

  const handleEssentialOnly = () => {
    setCookiePreferences({
      essential: true,
      analytics: false,
      timestamp: Date.now(),
    });
    setIsVisible(false);
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', { detail: { analytics: false } }));
  };

  if (!isVisible || deferred) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-4"
      role="dialog"
      aria-labelledby="cookie-banner-title"
    >
      <div className="mx-auto max-w-4xl rounded-xl border bg-card p-4 shadow-lg sm:p-6">
        <div className="flex items-start gap-4">
          <div className="hidden rounded-full bg-primary/10 p-2 sm:block">
            <Cookie className="size-6 text-primary" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 id="cookie-banner-title" className="text-base font-semibold sm:text-lg">
              {t('title')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('description')}
            </p>

            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">{t('essential_label')}</span>
              {': '}
              {t('essential_description')}
              <br />
              <span className="font-medium">{t('analytics_label')}</span>
              {': '}
              {t('analytics_description')}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {t('learn_more')}
              {' '}
              <Link href="/privacy" className="text-primary underline hover:no-underline">
                {t('privacy_link')}
              </Link>
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button onClick={handleAcceptAll} size="sm">
                {t('accept_all')}
              </Button>
              <Button onClick={handleEssentialOnly} variant="outline" size="sm">
                {t('essential_only')}
              </Button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleEssentialOnly}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('dismiss')}
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
