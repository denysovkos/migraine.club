'use client';

import { AlertTriangle, Bell, BellOff, Info, Loader2, Smartphone, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Env } from '@/libs/Env';

type NotificationStatus
  = | 'loading'
    | 'unsupported'
    | 'denied'
    | 'enabled'
    | 'disabled'
    | 'ios_hint'
    | 'not_configured';

type AlertsSettings = {
  alertsEnabled: boolean;
  hasLocation: boolean;
  timezone: string | null;
  migrationPending?: boolean;
};

/**
 * Check if the current browser is iOS Safari
 */
function isIOS(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

/**
 * Check if running as a PWA (standalone mode)
 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Convert a base64 string to Uint8Array for applicationServerKey
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationSettingsForm() {
  const t = useTranslations('NotificationSettings');
  const [status, setStatus] = useState<NotificationStatus>('loading');
  const [loading, setLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Daily risk alerts state
  const [alertsSettings, setAlertsSettings] = useState<AlertsSettings | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  // Get the current push subscription
  const getSubscription = useCallback(async (): Promise<PushSubscription | null> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }

    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }, []);

  // Check current notification status
  const checkStatus = useCallback(async () => {
    // Check if VAPID is configured
    const vapidKey = Env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setStatus('not_configured');
      return;
    }

    // Check browser support
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }

    // iOS-specific handling
    if (isIOS() && !isStandalone()) {
      setStatus('ios_hint');
      return;
    }

    // Check permission status
    if ('Notification' in window) {
      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }
    }

    // Check if already subscribed
    try {
      const subscription = await getSubscription();
      if (subscription) {
        setStatus('enabled');
      } else {
        setStatus('disabled');
      }
    } catch (err) {
      console.error('Error checking subscription:', err);
      setStatus('disabled');
    }
  }, [getSubscription]);

  // Initial status check
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Fetch alerts settings
  const fetchAlertsSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/user/alerts');
      if (!response.ok) {
        throw new Error(t('alerts_fetch_error'));
      }
      const data = await response.json();
      setAlertsSettings(data);
    } catch (err) {
      console.error('Error fetching alerts settings:', err);
      setAlertsError(t('alerts_fetch_error'));
    } finally {
      setAlertsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAlertsSettings();
  }, [fetchAlertsSettings]);

  // Toggle daily risk alerts
  const handleAlertsToggle = async (enabled: boolean) => {
    if (!alertsSettings) {
      return;
    }

    setAlertsLoading(true);
    setAlertsError(null);

    try {
      const response = await fetch('/api/user/alerts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alertsEnabled: enabled }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('alerts_update_error'));
      }

      setAlertsSettings(prev => prev ? { ...prev, alertsEnabled: enabled } : null);
    } catch (err) {
      console.error('Error updating alerts:', err);
      setAlertsError(err instanceof Error ? err.message : t('alerts_update_error'));
    } finally {
      setAlertsLoading(false);
    }
  };

  // Subscribe to push notifications
  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();

      if (permission === 'denied') {
        setStatus('denied');
        setLoading(false);
        return;
      }

      if (permission !== 'granted') {
        setError(t('permission_not_granted'));
        setLoading(false);
        return;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const vapidKey = Env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setError(t('vapid_not_configured'));
        setLoading(false);
        return;
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Extract keys
      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');

      if (!p256dh || !auth) {
        throw new Error(t('subscribe_error'));
      }

      // Convert keys to base64
      const subscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dh)))),
          auth: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(auth)))),
        },
        expirationTime: subscription.expirationTime,
      };

      // Send to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscriptionData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('subscribe_error'));
      }

      setStatus('enabled');
    } catch (err) {
      console.error('Error subscribing to push:', err);
      setError(err instanceof Error ? err.message : t('subscribe_error'));
    } finally {
      setLoading(false);
    }
  };

  // Unsubscribe from push notifications
  const handleUnsubscribe = async () => {
    setLoading(true);
    setError(null);

    try {
      const subscription = await getSubscription();

      if (subscription) {
        // Notify server first
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
          }),
        });

        // Unsubscribe in browser
        await subscription.unsubscribe();
      }

      setStatus('disabled');
    } catch (err) {
      console.error('Error unsubscribing from push:', err);
      setError(err instanceof Error ? err.message : t('unsubscribe_error'));
    } finally {
      setLoading(false);
    }
  };

  // Send test notification
  const handleTestNotification = async () => {
    setTestSending(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/push/test', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('test_error'));
      }

      setTestResult({
        success: true,
        message: t('test_success', { count: data.sentCount }),
      });
    } catch (err) {
      console.error('Error sending test notification:', err);
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : t('test_error'),
      });
    } finally {
      setTestSending(false);
    }
  };

  // Render status-specific content
  const renderStatus = () => {
    switch (status) {
      case 'loading':
        return (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        );

      case 'not_configured':
        return (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {t('status_not_configured')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('status_not_configured_detail')}
                </p>
              </div>
            </div>
          </div>
        );

      case 'unsupported':
        return (
          <div className="rounded-lg border border-muted bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">{t('status_unsupported')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('status_unsupported_detail')}
                </p>
              </div>
            </div>
          </div>
        );

      case 'denied':
        return (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <BellOff className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  {t('status_denied')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('status_denied_detail')}
                </p>
              </div>
            </div>
          </div>
        );

      case 'ios_hint':
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">{t('status_ios_hint')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('status_ios_hint_detail')}
                  </p>
                  <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                    <li>{t('ios_step_1')}</li>
                    <li>{t('ios_step_2')}</li>
                    <li>{t('ios_step_3')}</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        );

      case 'enabled':
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <Bell className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                <div className="flex-1">
                  <p className="font-medium text-emerald-600 dark:text-emerald-400">
                    {t('status_enabled')}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('status_enabled_detail')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestNotification}
                disabled={testSending}
                className="min-h-[44px]"
              >
                {testSending
                  ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t('sending_test')}
                      </>
                    )
                  : (
                      <>
                        <Bell className="mr-2 size-4" />
                        {t('send_test')}
                      </>
                    )}
              </Button>

              <Button
                type="button"
                variant="destructive"
                onClick={handleUnsubscribe}
                disabled={loading}
                className="min-h-[44px]"
              >
                {loading
                  ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t('disabling')}
                      </>
                    )
                  : (
                      <>
                        <BellOff className="mr-2 size-4" />
                        {t('disable_button')}
                      </>
                    )}
              </Button>
            </div>

            {testResult && (
              <div
                className={`rounded-md p-3 text-sm ${
                  testResult.success
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-destructive/15 text-destructive'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        );

      case 'disabled':
      default:
        return (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t('status_disabled')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('status_disabled_detail')}
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleSubscribe}
              disabled={loading}
              className="min-h-[44px]"
            >
              {loading
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t('enabling')}
                    </>
                  )
                : (
                    <>
                      <Bell className="mr-2 size-4" />
                      {t('enable_button')}
                    </>
                  )}
            </Button>
          </div>
        );
    }
  };

  // Render daily risk alerts section
  const renderAlertsSection = () => {
    // Only show if push notifications are enabled
    if (status !== 'enabled') {
      return null;
    }

    if (alertsLoading && !alertsSettings) {
      return (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (!alertsSettings) {
      return null;
    }

    // Check if migration is pending
    if (alertsSettings.migrationPending) {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {t('alerts_coming_soon')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('alerts_coming_soon_detail')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Check if location is configured
    if (!alertsSettings.hasLocation) {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {t('alerts_no_location')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('alerts_no_location_detail')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Sun className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <Label
                  htmlFor="alerts-toggle"
                  className="cursor-pointer font-medium"
                >
                  {t('alerts_title')}
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('alerts_description')}
                </p>
                {alertsSettings.timezone && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('alerts_timezone', { timezone: alertsSettings.timezone })}
                  </p>
                )}
              </div>
            </div>
            <Switch
              id="alerts-toggle"
              checked={alertsSettings.alertsEnabled}
              onCheckedChange={handleAlertsToggle}
              disabled={alertsLoading}
            />
          </div>
        </div>

        {alertsSettings.alertsEnabled && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 size-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {t('alerts_enabled_info')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Push Notifications Section */}
      <div>
        <h3 className="mb-4 text-lg font-semibold">{t('push_section_title')}</h3>
        {renderStatus()}
      </div>

      {/* Daily Risk Alerts Section */}
      {status === 'enabled' && (
        <div className="border-t pt-6">
          <h3 className="mb-4 text-lg font-semibold">{t('alerts_section_title')}</h3>
          {renderAlertsSection()}
          {alertsError && (
            <div className="mt-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {alertsError}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
