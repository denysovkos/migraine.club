'use client';

import type { OutboxItem } from '@/libs/offline/outboxStore';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { showSnackbar } from '@/features/snackbar';
import {
  flushOutbox,
  getOutboxUser,
  listOutbox,
  removeOutboxItem,
  retryOutboxItem,
  subscribeOutbox,
} from '@/libs/offline/outbox';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

/**
 * Small status pill shown only while something is offline-related: no
 * connection, entries waiting to sync, or entries that need attention.
 * Tapping it lists what's stored on the device.
 */
export function OfflineSyncIndicator() {
  const t = useTranslations('OfflineSync');
  const format = useFormatter();
  const router = useRouter();
  const online = useIsOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const prevPendingRef = useRef(0);

  const reload = useCallback(async () => {
    setItems(await listOutbox(getOutboxUser()));
  }, []);

  useEffect(() => {
    void reload();
    return subscribeOutbox(() => void reload());
  }, [reload]);

  const pending = items.filter(i => i.status === 'pending');
  const failed = items.filter(i => i.status === 'failed');

  // Tell the user once a backlog has drained, and refresh server-rendered data.
  useEffect(() => {
    if (online && prevPendingRef.current > 0 && pending.length === 0) {
      const synced = prevPendingRef.current - failed.length;
      if (synced > 0) {
        showSnackbar({ message: t('synced_toast', { count: synced }) });
      }
      if (failed.length > 0) {
        showSnackbar({ message: t('failed_toast') });
      }
      router.refresh();
    }
    prevPendingRef.current = pending.length;
  }, [online, pending.length, failed.length, router, t]);

  async function syncNow() {
    setSyncing(true);
    try {
      const summary = await flushOutbox();
      if (summary.stoppedBy === 'auth' || summary.stoppedBy === 'wrong_user') {
        showSnackbar({ message: t('signin_needed') });
      }
    } finally {
      setSyncing(false);
      void reload();
    }
  }

  if (online && items.length === 0) {
    return null;
  }

  let label: string;
  let Icon = CloudOff;
  let tone: 'muted' | 'warn' = 'muted';
  if (failed.length > 0) {
    label = t('status_failed', { count: failed.length });
    Icon = AlertTriangle;
    tone = 'warn';
  } else if (!online) {
    label = pending.length > 0 ? t('status_offline_pending', { count: pending.length }) : t('status_offline');
  } else {
    label = t('status_syncing', { count: pending.length });
    Icon = RefreshCw;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={items.length === 0}
        aria-live="polite"
        className="mc-ring fixed left-1/2 z-40 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium shadow-md"
        style={{
          top: 'calc(env(safe-area-inset-top) + 8px)',
          background: tone === 'warn' ? 'var(--mc-attack-bg, #fef2f2)' : 'var(--mc-surface)',
          color: tone === 'warn' ? 'var(--mc-attack-fg, #b91c1c)' : 'var(--mc-fg)',
          border: '1px solid var(--mc-border)',
        }}
      >
        <Icon className={`size-4 shrink-0${Icon === RefreshCw ? ' animate-spin' : ''}`} aria-hidden />
        <span className="truncate">{label}</span>
      </button>

      <BottomSheet open={open} onOpenChange={setOpen} title={t('sheet_title')}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('sheet_sub')}</p>

          <ul className="space-y-2">
            {items.map(item => (
              <li key={item.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {t(`kind_${item.kind}`)}
                      {item.label ? ` · ${item.label}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('captured_at', {
                        time: format.dateTime(new Date(item.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}
                    </div>
                    <div className={`mt-1 text-xs ${item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {item.status === 'failed' ? t('state_failed') : t('state_pending')}
                      {item.status === 'failed' && item.lastError ? ` · ${item.lastError}` : ''}
                    </div>
                  </div>
                  {item.status === 'failed' && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-medium"
                        onClick={() => void retryOutboxItem(item.id)}
                      >
                        {t('retry')}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-medium text-destructive"
                        onClick={() => {
                          // eslint-disable-next-line no-alert
                          if (window.confirm(t('discard_confirm'))) {
                            void removeOutboxItem(item.id);
                          }
                        }}
                      >
                        {t('discard')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="h-11 w-full rounded-xl border text-sm font-medium disabled:opacity-50"
            disabled={!online || syncing || pending.length === 0}
            onClick={() => void syncNow()}
          >
            {syncing ? t('syncing') : online ? t('sync_now') : t('waiting_for_connection')}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
