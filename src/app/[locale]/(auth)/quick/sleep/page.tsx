'use client';

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { logSleepAdherence } from '@/features/programs/programsApi';
import { showSnackbar } from '@/features/snackbar';

/**
 * Deep-link landing for the morning check-in / wind-down notifications.
 *
 * iOS Safari ignores notification action buttons — users tap the body and
 * arrive here. We auto-apply the value from the query string (?d=YYYY-MM-DD&v=on_target),
 * show a brief confirmation toast, then redirect to the dashboard.
 *
 * On Android/desktop the SW handles the action directly via /api/programs/sleep-regularity/log
 * and never opens this route.
 */
function QuickSleepInner() {
  const t = useTranslations('QuickSleep');
  const router = useRouter();
  const params = useSearchParams();
  const fired = useRef(false);
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>('pending');

  useEffect(() => {
    if (fired.current) {
      return;
    }
    fired.current = true;

    const date = params.get('d');
    const value = params.get('v');
    if (!date || !value) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        if (value === 'on_target') {
          // Server pulls target from active enrollment when bedTime/wakeTime omitted.
          // Recorder will mark `na` rather than `hit` if no target available — guard here.
          const detailRes = await fetch('/api/programs/sleep-regularity', { cache: 'no-store' });
          const detail = detailRes.ok ? await detailRes.json() : null;
          const target = detail?.activeEnrollment?.targetPayload as
            | { bedTime: string; wakeTime: string } | undefined;
          if (!target) {
            setStatus('error');
            return;
          }
          await logSleepAdherence({
            localDate: date,
            bedTimeLocal: target.bedTime,
            wakeTimeLocal: target.wakeTime,
          });
        } else if (value === 'skip') {
          await logSleepAdherence({ localDate: date, bedTimeLocal: null, wakeTimeLocal: null });
        } else if (value === 'off_track') {
          // Need actual times — route to diary.
          router.replace(`/dashboard/diary?date=${date}`);
          return;
        } else {
          setStatus('error');
          return;
        }
        showSnackbar({ message: t('saved') });
        setStatus('done');
        setTimeout(() => router.replace('/dashboard'), 800);
      } catch {
        setStatus('error');
      }
    })();
  }, [params, router, t]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <div>
        {status === 'pending' && <div className="text-sm text-muted-foreground">{t('saving')}</div>}
        {status === 'done' && <div className="text-sm font-medium">{t('saved')}</div>}
        {status === 'error' && (
          <div className="text-sm text-destructive">{t('error_message')}</div>
        )}
      </div>
    </div>
  );
}

export default function QuickSleepPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center p-6" />}>
      <QuickSleepInner />
    </Suspense>
  );
}
