'use client';

import { format } from 'date-fns';
import { enUS, fr, uk } from 'date-fns/locale';
import { Sun } from 'lucide-react';
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

function dateLocale(locale: string) {
  if (locale === 'fr') {
    return fr;
  }
  if (locale === 'uk') {
    return uk;
  }
  return enUS;
}

function formatTime(iso: string, locale: string): string {
  return format(new Date(iso), 'MMM d, HH:mm', { locale: dateLocale(locale) });
}

function providerLabel(p: KpProviderId, t: ReturnType<typeof useTranslations<'SolarKpCard'>>) {
  if (p === 'noaa') {
    return t('provider_noaa');
  }
  if (p === 'gfz') {
    return t('provider_gfz');
  }
  return t('provider_nasa');
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'mono' }) {
  const tones = {
    neutral: { bg: 'var(--mc-bg-subtle)', fg: 'var(--mc-fg-muted)' },
    warn: { bg: 'var(--mc-warn-bg)', fg: 'var(--mc-warn-fg)' },
    mono: { bg: 'var(--mc-bg-subtle)', fg: 'var(--mc-fg-2)' },
  };
  const s = tones[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold${tone === 'mono' ? ' font-mono' : ''}`}
      style={{ background: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

export function SolarActivityCard() {
  const t = useTranslations('SolarKpCard');
  const tDash = useTranslations('DashboardHome');
  const locale = useLocale();
  const [data, setData] = useState<KpAggregateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/space-weather/kp');
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || 'Failed to fetch Kp');
        }
        const payload: KpAggregateDto = await res.json();
        if (!cancelled) {
          setData(payload);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avgDisplay = useMemo(() => {
    if (data?.avgKp == null) {
      return null;
    }
    return Math.round(data.avgKp * 100) / 100;
  }, [data?.avgKp]);

  if (loading) {
    return (
      <section className="mc-card">
        <div className="animate-pulse">
          <div className="mb-3 h-5 w-40 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="mb-3 h-10 w-24 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="h-16 w-full rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return null;
  }

  return (
    <section className="mc-card">
      <div className="flex items-start gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--mc-med-bg)', color: 'var(--mc-med-fg)' }}
        >
          <Sun className="size-[15px]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {t('title')}
          </h3>
          <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            {tDash('solar_subtitle', { time: formatTime(data.computedAt, locale) })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="mc-tnum text-[40px] font-bold leading-none" style={{ color: 'var(--mc-fg)' }}>
          {avgDisplay != null ? avgDisplay.toFixed(2) : '—'}
        </span>
        <span className="text-[14px] font-medium" style={{ color: 'var(--mc-fg-muted)' }}>{t('kp_unit')}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px]" style={{ color: 'var(--mc-fg-muted)' }}>
          {t('sources_used', { count: data.sourcesUsed })}
        </span>
        {data.spread != null && (
          <Pill>
            {t('spread', { spread: (Math.round(data.spread * 100) / 100).toFixed(2) })}
          </Pill>
        )}
        {data.noaaScale && (
          <Pill>{t('noaa_scale', { scale: data.noaaScale })}</Pill>
        )}
      </div>

      {data.lastStorm && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--mc-bg-subtle)', color: 'var(--mc-fg-2)' }}
        >
          <span style={{ color: 'var(--mc-fg-muted)' }}>{tDash('solar_last_storm_peak')}</span>
          {' '}
          <span className="mc-tnum font-semibold">
            {tDash('solar_storm_kp', { value: (Math.round(data.lastStorm.peakKp * 10) / 10).toFixed(1) })}
          </span>
          <span style={{ color: 'var(--mc-fg-muted)' }}>
            {' '}
            {tDash('solar_storm_at', { time: formatTime(data.lastStorm.peakTime, locale) })}
          </span>
        </div>
      )}

      <div className="my-3 h-px" style={{ background: 'var(--mc-border)' }} />

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
        {t('sources_title')}
      </div>
      <ul className="space-y-2.5">
        {data.readings.length === 0 && (
          <li className="text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            {t('no_sources')}
          </li>
        )}
        {data.readings.map((r) => {
          const sourceId = r.meta?.sourceId ? String(r.meta.sourceId) : null;
          return (
            <li key={`${r.provider}-${r.timestamp}`} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--mc-fg)' }}>
                    {providerLabel(r.provider, t)}
                  </span>
                  {r.stale && <Pill tone="warn">{t('stale')}</Pill>}
                  {sourceId && <Pill tone="mono">{sourceId}</Pill>}
                </div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
                  {t('observed_at', { time: formatTime(r.timestamp, locale) })}
                </div>
              </div>
              <span className="mc-tnum shrink-0 text-[16px] font-bold" style={{ color: 'var(--mc-fg)' }}>
                {Number.isFinite(r.value) ? r.value.toFixed(2) : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      {data.error && (
        <div className="mt-3 text-[12px]" style={{ color: 'var(--mc-bad-fg)' }}>
          {data.error}
        </div>
      )}
    </section>
  );
}
