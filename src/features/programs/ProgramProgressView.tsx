'use client';

import type { ProgressDTO } from './programsApi';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

import { showSnackbar } from '@/features/snackbar';
import {
  endEnrollment,
  fetchProgramProgress,
  pauseEnrollment,
} from './programsApi';

export function ProgramProgressView({ programId }: { programId: string }) {
  const t = useTranslations('ProgramProgress');
  const [data, setData] = useState<ProgressDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgramProgress(programId)
      .then(setData)
      .catch(() => setError(t('load_error')));
  }, [programId, t]);

  if (error) {
    return <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  const pct = Math.round(Math.abs(data.summary.comparison.percentChange) * 100);
  const directionWord = t(`direction_${data.summary.comparison.directionLabel}`);
  const noLogsYet = data.summary.evalDaysPassed === 0
    && data.summary.adherence === 0
    && data.summary.coverage === 0;

  return (
    <div className="space-y-3">
      {noLogsYet && (
        <div className="rounded-2xl border-l-4 border-sky-500 bg-sky-50/60 p-4 dark:bg-sky-950/20">
          <div className="text-sm font-semibold text-sky-900 dark:text-sky-100">
            {t('howto_title')}
          </div>
          {programId === 'acute-med-timing'
            ? (
                <>
                  <ol className="ml-5 mt-2 list-decimal space-y-1 text-sm text-sky-900/90 dark:text-sky-100/90">
                    <li>{t('howto_step_acute_log_attack')}</li>
                    <li>{t('howto_step_acute_log_dose')}</li>
                    <li>{t('howto_step_acute_review')}</li>
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" className="min-h-10">
                      <Link href="/dashboard">{t('howto_cta_dashboard')}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="min-h-10">
                      <Link href="/dashboard/episodes">{t('howto_cta_episodes')}</Link>
                    </Button>
                  </div>
                </>
              )
            : (
                <>
                  <ol className="ml-5 mt-2 list-decimal space-y-1 text-sm text-sky-900/90 dark:text-sky-100/90">
                    <li>{t('howto_step_dashboard')}</li>
                    <li>{t('howto_step_diary')}</li>
                    <li>{t('howto_step_review')}</li>
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" className="min-h-10">
                      <Link href="/dashboard">{t('howto_cta_dashboard')}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="min-h-10">
                      <Link href="/dashboard/diary">{t('howto_cta_diary')}</Link>
                    </Button>
                  </div>
                </>
              )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('adherence')}
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {Math.round(data.summary.adherence * 100)}
            %
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('coverage')}
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {Math.round(data.summary.coverage * 100)}
            %
          </div>
        </div>
      </div>

      {data.summary.evalDaysPassed > 0
        ? (
            <div className="rounded-2xl border-l-4 border-emerald-500 bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
              <div className="text-sm leading-relaxed">
                {t('headache_days_change', {
                  baseline: data.summary.comparison.baseline.headacheDays,
                  baselineDays: data.summary.comparison.baseline.totalDays,
                  evaluation: data.summary.comparison.evaluation.headacheDays,
                  evalDays: data.summary.comparison.evaluation.totalDays,
                })}
                <br />
                <strong>{t('associated_with', { pct, direction: directionWord })}</strong>
                {' '}
                {t('confidence_label', { level: t(`confidence_${data.confidence}`) })}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">{t('association_caveat')}</div>
            </div>
          )
        : (
            <div className="rounded-2xl border bg-card p-3 text-sm text-muted-foreground">
              {t('eval_window_pending', { date: data.enrollment.evaluationWindowStart })}
            </div>
          )}

      <div
        role="note"
        className="flex items-start gap-3 rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <span aria-hidden className="mt-0.5 text-lg leading-none">⚠</span>
        <p className="text-sm">{t('disclaimer')}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          onClick={async () => {
            await pauseEnrollment(programId, data.enrollment.id);
            showSnackbar({ message: t('paused_toast') });
          }}
        >
          {t('pause')}
        </Button>
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          onClick={async () => {
            await endEnrollment(programId, data.enrollment.id);
            showSnackbar({ message: t('ended_toast') });
          }}
        >
          {t('end')}
        </Button>
      </div>
    </div>
  );
}
