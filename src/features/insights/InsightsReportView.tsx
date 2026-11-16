'use client';

import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type ApiResponse
  = | { state: 'disabled'; message?: string }
    | { state: 'consent_required'; message?: string }
    | { state: 'ready'; windowDays: number; methodVersion: string; payload: any; computedAt: string };

export function InsightsReportView() {
  const t = useTranslations('InsightsReport');
  const searchParams = useSearchParams();
  const windowParam = Number(searchParams.get('window') ?? '90');
  const windowDays = [30, 60, 90].includes(windowParam) ? windowParam : 90;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/insights?windowDays=${windowDays}`, { cache: 'no-store' });
        const data: ApiResponse = await res.json();
        if (!mounted) {
          return;
        }
        if (data.state !== 'ready') {
          setError(data.message ?? t('error'));
          setLoading(false);
          return;
        }
        setPayload(data.payload);
        setLoading(false);
      } catch (e: any) {
        if (!mounted) {
          return;
        }
        setError(e?.message ?? t('error'));
        setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [windowDays, t]);

  if (loading) {
    return <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('loading')}</div>;
  }
  if (error) {
    return <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  }

  const readiness = payload?.dataReadiness;
  const buckets = payload?.buckets ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-lg font-semibold">{t('title')}</div>
          <div className="text-sm text-muted-foreground">
            {t('range_label', { days: windowDays })}
          </div>
          {payload?.computedAt && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t('computed_at', { date: DateTime.fromISO(payload.computedAt).toLocaleString(DateTime.DATE_MED) })}
            </div>
          )}
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => window.print()}>
          {t('print')}
        </Button>
      </div>

      {readiness && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="font-medium">{t('readiness_title')}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_coverage')}</div>
              <div className="mt-0.5 font-medium">
                {Math.round((readiness.diaryCoveragePct ?? 0) * 100)}
                %
              </div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_attacks')}</div>
              <div className="mt-0.5 font-medium">{readiness.attackStarts}</div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_missing')}</div>
              <div className="mt-0.5 font-medium">
                {readiness.missing?.length ? readiness.missing.join(', ') : t('readiness_good')}
              </div>
            </div>
          </div>
        </div>
      )}

      {buckets.map((b: any) => (
        <div key={b.id} className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{b.title}</div>
          {b.items?.length
            ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {b.items.map((c: any) => (
                    <div key={c.id} className="rounded-lg border bg-muted p-3 text-sm">
                      <div className="font-medium">{c.factorName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('window_label')}
                        {' '}
                        {c.window}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t('rates_label')}
                        {' '}
                        {Math.round((c.caseRate ?? 0) * 100)}
                        %
                        {' vs '}
                        {Math.round((c.controlRate ?? 0) * 100)}
                        %
                      </div>
                    </div>
                  ))}
                </div>
              )
            : (
                <div className="mt-2 text-sm text-muted-foreground">{t('empty_bucket')}</div>
              )}
        </div>
      ))}

      <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
        {t('disclaimer')}
      </div>
    </div>
  );
}
