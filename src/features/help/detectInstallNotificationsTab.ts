import type { InstallNotificationsTabId } from './installNotificationsContent';

export function detectInstallNotificationsTabFromUserAgent(
  userAgent: string | null | undefined,
): InstallNotificationsTabId {
  const ua = (userAgent || '').toLowerCase();

  // iOS: iPhone/iPad/iPod (note: iPadOS may present as Mac; this is best-effort)
  if (/iphone|ipad|ipod/.test(ua)) {
    return 'ios';
  }

  if (/android/.test(ua)) {
    return 'android';
  }

  return 'desktop';
}
