'use client';

import type { PainLevel } from '@/utils/painLevel';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { PainLevelPicker } from '@/components/PainLevelPicker';
import { Button } from '@/components/ui/button';

export function QuickEpisodeLog({ onLogged }: { onLogged?: () => void }) {
  const t = useTranslations('episodes.quickLog');
  const router = useRouter();
  const [intensity, setIntensity] = useState<PainLevel>(3);
  const [ongoing, setOngoing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'quick', intensity, isOngoing: ongoing }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('error_generic'));
      }
      onLogged?.();
      router.refresh();
    } catch (e: any) {
      setError(e.message || t('error_generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-medium">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">{t('intensity_label')}</label>
          <PainLevelPicker value={intensity} onChange={setIntensity} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('start_now')}</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ongoing}
              onChange={e => setOngoing(e.target.checked)}
            />
            {t('ongoing_toggle')}
          </label>
        </div>
        {error && <div className="text-sm text-destructive">{t('error_generic')}</div>}
        <Button className="w-full" onClick={onSubmit} disabled={loading}>
          {loading ? t('logging') : t('log_now')}
        </Button>
      </div>
    </div>
  );
}
