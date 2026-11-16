'use client';

import { format } from 'date-fns';
import { enUS, fr, uk } from 'date-fns/locale';
import { AlertTriangle, Sun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

type KpProviderId = 'noaa' | 'gfz' | 'nasa';

type KpReadingDto = {
  provider: KpProviderId;
  value: number;
  timestamp: string;
  stale: boolean;
  meta: Record<string, any> | null;
};

type KpAggregateDto = {
  avgKp: number | null;
  sourcesUsed: number;
  computedAt: string;
  noaaScale: string | null;
  lastStorm: null | { startTime: string; endTime: string; peakKp: number; peakTime: string };
  error: string | null;
  readings: KpReadingDto[];
  minKp: number | null;
  maxKp: number | null;
  spread: number | null;
};

function providerLabel(provider: KpProviderId, t: ReturnType<typeof useTranslations<'SolarKpCard'>>): string {
  switch (provider) {
    case 'noaa':
      return t('provider_noaa');
    case 'gfz':
      return t('provider_gfz');
    case 'nasa':
      return t('provider_nasa');
  }
}

function formatTime(iso: string, locale: string): string {
  const dateFnsLocale = locale === 'fr' ? fr : locale === 'uk' ? uk : enUS;
  return format(new Date(iso), 'MMM d, HH:mm', { locale: dateFnsLocale });
}

export function SolarKpCard() {
  const t = useTranslations('SolarKpCard');
  const locale = useLocale();
  const [data, setData] = useState<KpAggregateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/space-weather/kp');
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || 'Failed to fetch Kp');
        }
        const payload: KpAggregateDto = await res.json();
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const avgDisplay = useMemo(() => {
    if (data?.avgKp == null) {
      return null;
    }
    return Math.round(data.avgKp * 100) / 100;
  }, [data?.avgKp]);

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="animate-pulse">
          <div className="mb-4 h-6 w-56 rounded bg-muted"></div>
          <div className="mb-2 h-16 w-28 rounded bg-muted"></div>
          <div className="h-4 w-40 rounded bg-muted"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3 text-destructive">
          <AlertTriangle className="mt-1 size-5" />
          <div>
            <h3 className="font-semibold">{t('title')}</h3>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const updatedAt = formatTime(data.computedAt, locale);

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t('title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('last_updated', { time: updatedAt })}
          </p>
        </div>
        <Sun className="mt-1 size-5 text-amber-500" />
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-5xl font-bold tabular-nums">
          {avgDisplay !== null ? avgDisplay.toFixed(2) : t('na')}
        </span>
        <span className="text-sm text-muted-foreground">{t('kp_unit')}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          {t('sources_used', { count: data.sourcesUsed })}
        </span>
        {data.noaaScale
          ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                {t('noaa_scale', { scale: data.noaaScale })}
              </span>
            )
          : null}
        {data.spread != null
          ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {t('spread', { spread: (Math.round(data.spread * 100) / 100).toFixed(2) })}
              </span>
            )
          : null}
      </div>

      {data.lastStorm
        ? (
            <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              {t('last_storm_peak', {
                kp: (Math.round(data.lastStorm.peakKp * 10) / 10).toFixed(1),
                time: formatTime(data.lastStorm.peakTime, locale),
              })}
            </div>
          )
        : null}

      <div className="mt-4 border-t pt-4">
        <div className="text-sm font-medium">
          {t('sources_title')}
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {data.readings.length === 0
            ? (
                <div className="text-muted-foreground">{t('no_sources')}</div>
              )
            : (
                data.readings.map((r) => {
                  const ts = formatTime(r.timestamp, locale);
                  return (
                    <div key={`${r.provider}-${r.timestamp}`} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{providerLabel(r.provider, t)}</span>
                          {r.stale
                            ? (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                  {t('stale')}
                                </span>
                              )
                            : null}
                          {r.meta?.sourceId
                            ? (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  <span className="block max-w-40 truncate" title={String(r.meta.sourceId)}>
                                    {String(r.meta.sourceId)}
                                  </span>
                                </span>
                              )
                            : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {t('observed_at', { time: ts })}
                        </div>
                      </div>
                      <div className="shrink-0 font-mono text-sm tabular-nums">
                        {Number.isFinite(r.value) ? r.value.toFixed(2) : t('na')}
                      </div>
                    </div>
                  );
                })
              )}
        </div>
      </div>

      {data.error
        ? (
            <div className="mt-3 text-xs text-destructive">
              {data.error}
            </div>
          )
        : null}
    </div>
  );
}
