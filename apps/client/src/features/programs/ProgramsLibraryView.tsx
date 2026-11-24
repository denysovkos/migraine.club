'use client';

import type { ProgramSummary } from './programsApi';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import { fetchPrograms } from './programsApi';

export function ProgramsLibraryView() {
  const t = useTranslations('ProgramsLibrary');
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrograms()
      .then(({ programs }) => setPrograms(programs))
      .catch(() => setError(t('load_error')));
  }, [t]);

  if (error) {
    return <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
  }
  if (!programs) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('disclaimer')}</p>
      {programs.map(p => (
        <Link
          key={p.id}
          href={`/dashboard/programs/${p.id}`}
          className="block rounded-2xl border bg-card p-4 transition hover:bg-muted/40"
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {p.shape === 'daily-habit' ? t('shape_daily_habit') : t('shape_per_attack')}
          </div>
          <div className="mt-1 text-base font-semibold">{p.title}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t('citations', { count: p.citationCount })}
            {' · '}
            {t('weeks', { count: p.durationWeeks })}
          </div>
        </Link>
      ))}
    </div>
  );
}
