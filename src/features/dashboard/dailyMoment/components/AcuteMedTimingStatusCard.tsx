'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { fetchProgramDetail, fetchProgramSettings } from '@/features/programs/programsApi';

type Status = {
  acuteWindowMinutes: number;
};

/**
 * Passive status card for Acute Med Timing on the home dashboard.
 *
 * The program itself runs silently (computed from episode + acute_doses), so
 * without this card users wouldn't see any sign of their enrollment on home.
 * No daily action — links to progress and surfaces target.
 */
export function AcuteMedTimingStatusCard() {
  const t = useTranslations('AcuteMedTimingStatusCard');
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await fetchProgramSettings().catch(() => null);
      if (cancelled || !settings?.enabled) {
        return;
      }
      const detail = await fetchProgramDetail('acute-med-timing').catch(() => null);
      if (cancelled || !detail?.activeEnrollment) {
        return;
      }
      const target = detail.activeEnrollment.targetPayload as { acuteWindowMinutes: number };
      setStatus({ acuteWindowMinutes: target.acuteWindowMinutes });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return null;
  }

  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
            {t('header', { minutes: status.acuteWindowMinutes })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('how_it_works')}</p>
        </div>
        <Link
          href="/dashboard/programs/acute-med-timing/progress"
          className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
        >
          {t('view_progress')}
        </Link>
      </div>
    </div>
  );
}
