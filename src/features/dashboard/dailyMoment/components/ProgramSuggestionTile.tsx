'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { fetchProgramSettings } from '@/features/programs/programsApi';

type Recommendation = { id: string; title: string; reason: string };

export function ProgramSuggestionTile() {
  const t = useTranslations('ProgramSuggestion');
  const [rec, setRec] = useState<Recommendation | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await fetchProgramSettings().catch(() => null);
      if (cancelled || !settings?.enabled) {
        return;
      }
      const res = await fetch('/api/programs/recommendations', { cache: 'no-store' });
      if (cancelled || !res.ok) {
        return;
      }
      const json = await res.json();
      const first = (json?.recommendations as Recommendation[] | undefined)?.[0];
      if (!cancelled && first) {
        setRec(first);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismiss() {
    if (!rec) {
      return;
    }
    await fetch(`/api/programs/recommendations/${rec.id}/dismiss`, { method: 'POST' });
    setRec(null);
  }

  if (!rec) {
    return null;
  }

  return (
    <div className="rounded-2xl border-2 border-sky-500 bg-sky-50/60 p-3 dark:bg-sky-950/20">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            {t('label')}
          </div>
          <div className="mt-1 font-semibold">{rec.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{rec.reason}</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button asChild size="sm" className="min-h-11 flex-1">
          <Link href={`/dashboard/programs/${rec.id}`}>{t('see_program')}</Link>
        </Button>
        <Button variant="outline" size="sm" className="min-h-11 flex-1" onClick={dismiss}>
          {t('not_now')}
        </Button>
      </div>
    </div>
  );
}
