'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/utils/Helpers';

type ChipData = {
  targetMinutes: number;
  onsetToDoseMinutes: number | null;
  signal: 'hit' | 'miss' | 'na';
};

/**
 * Tiny chip showing acute med timing for a specific attack.
 * Renders nothing if module disabled, no enrollment, or attack not found (all 404 cases).
 */
export function AttackTimingChip({ attackId, refreshToken }: { attackId: number; refreshToken?: number }) {
  const t = useTranslations('AttackTimingChip');
  const [data, setData] = useState<ChipData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/programs/acute-med-timing/attack/${attackId}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) {
          setData(json);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attackId, refreshToken]);

  if (!data) {
    return null;
  }

  if (data.signal === 'na') {
    // No dose taken yet — show passive hint with target.
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
        <span aria-hidden>⏱</span>
        {t('not_taken_yet', { minutes: data.targetMinutes })}
      </div>
    );
  }

  const isHit = data.signal === 'hit';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
        isHit
          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
          : 'border-rose-500 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200',
      )}
    >
      <span aria-hidden>{isHit ? '✓' : '⚠'}</span>
      {isHit
        ? t('within_target', { minutes: data.onsetToDoseMinutes ?? 0, target: data.targetMinutes })
        : t('past_target', { minutes: data.onsetToDoseMinutes ?? 0, target: data.targetMinutes })}
    </div>
  );
}
