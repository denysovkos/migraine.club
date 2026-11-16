'use client';

import { useCallback, useEffect, useState } from 'react';

export type NotificationPermissionState = 'unsupported' | NotificationPermission;

function readPermission(): NotificationPermissionState {
  if (typeof window === 'undefined') {
    return 'unsupported';
  }
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');

  const refresh = useCallback(() => {
    setPermission(readPermission());
  }, []);

  useEffect(() => {
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [refresh]);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return 'unsupported';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      const current = readPermission();
      setPermission(current);
      return current;
    }
  }, []);

  return {
    permission,
    refresh,
    requestPermission,
  };
}
