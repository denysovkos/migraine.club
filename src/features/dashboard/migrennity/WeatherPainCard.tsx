'use client';

import type { CurrentWpiResponse, WpiLevelType } from '@/types/WeatherPainIndex';
import { Cloud, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useState } from 'react';

const PILL_BY_LEVEL: Record<WpiLevelType, { bg: string; fg: string }> = {
  low: { bg: 'var(--mc-good-bg)', fg: 'var(--mc-good-fg)' },
  moderate: { bg: 'var(--mc-warn-bg)', fg: 'var(--mc-warn-fg)' },
  high: { bg: '#ffedd5', fg: '#9a3412' },
  very_high: { bg: 'var(--mc-bad-bg)', fg: 'var(--mc-bad-fg)' },
};

// Calm, soft-saturation palette — avoids high-chroma reds/ambers that
// can aggravate light-sensitive eyes.
function factorColor(pct: number): string {
  if (pct < 25) {
    return '#6aa66f';
  }
  if (pct < 50) {
    return '#d4a83b';
  }
  if (pct < 75) {
    return '#c87a3a';
  }
  return '#b85c4a';
}

function FactorBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] font-medium" style={{ color: 'var(--mc-fg-2)' }}>{label}</span>
        <span className="mc-tnum text-[11.5px] font-semibold" style={{ color: 'var(--mc-fg-muted)' }}>
          {pct}
          %
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--mc-bg-subtle)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: factorColor(pct) }}
        />
      </div>
    </div>
  );
}

function MetricInline({ icon, label, value, sub, accent }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-center gap-1.5">
        {icon && (
          <span className="shrink-0" style={{ color: accent ?? 'var(--mc-fg-muted)' }}>
            {icon}
          </span>
        )}
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--mc-fg-muted)' }}>
          {label}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-1">
        <span className="mc-tnum text-[13.5px] font-semibold leading-tight" style={{ color: 'var(--mc-fg)' }}>
          {value}
        </span>
        {sub && (
          <span className="text-[11px] leading-tight" style={{ color: 'var(--mc-fg-muted)' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function kpSub(kp: number | null, t: ReturnType<typeof useTranslations<'WpiCard'>>): string {
  if (kp == null) {
    return t('kp_no_data');
  }
  if (kp <= 2) {
    return t('kp_quiet');
  }
  if (kp <= 4) {
    return t('kp_unsettled');
  }
  if (kp <= 5) {
    return t('kp_active');
  }
  if (kp <= 7) {
    return t('kp_minor_storm');
  }
  if (kp <= 8) {
    return t('kp_major_storm');
  }
  return t('kp_severe_storm');
}

export function WeatherPainCard() {
  const t = useTranslations('WpiCard');
  const [data, setData] = useState<CurrentWpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/weather-pain-index/current');
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          if (e.code === 'SETTINGS_NOT_FOUND') {
            if (!cancelled) {
              setSettingsRequired(true);
            }
            return;
          }
          throw new Error(e.error || 'Failed to fetch WPI');
        }
        const payload: CurrentWpiResponse = await res.json();
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

  if (loading) {
    return (
      <section className="mc-card">
        <div className="animate-pulse">
          <div className="mb-3 h-5 w-44 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="mb-3 h-10 w-28 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="mb-3 h-1.5 w-full rounded-full" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => `m-${i}`).map(k => (
              <div key={k} className="h-10 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (settingsRequired) {
    return (
      <section className="mc-card">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--mc-info-bg)', color: 'var(--mc-info-fg)' }}
          >
            <Cloud className="size-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--mc-fg)' }}>{t('title')}</h3>
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>{t('setup_location')}</p>
            <Link
              href="/dashboard/settings/location"
              className="mc-ring mt-3 inline-block text-[13px] font-semibold"
              style={{ color: 'var(--mc-brand-press)' }}
            >
              {t('set_up_location_link')}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return null;
  }

  const score = data.score;
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  const pill = PILL_BY_LEVEL[data.level];
  const levelLabels: Record<WpiLevelType, string> = {
    low: t('level_low'),
    moderate: t('level_moderate'),
    high: t('level_high'),
    very_high: t('level_very_high'),
  };

  return (
    <section className="mc-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2">
            <Cloud className="size-4" strokeWidth={1.8} style={{ color: 'var(--mc-fg-2)' }} />
            <h3 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
              {t('title')}
            </h3>
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            Composite risk · 0–10
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: pill.bg, color: pill.fg }}
        >
          {levelLabels[data.level]}
        </span>
      </div>

      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="mc-tnum text-[40px] font-bold leading-none" style={{ color: 'var(--mc-fg)' }}>
          {score.toFixed(1)}
        </span>
        <span className="mc-tnum text-[14px] font-medium" style={{ color: 'var(--mc-fg-muted)' }}>
          / 10
        </span>
      </div>
      <div
        className="mc-pain-track relative mb-4 h-1.5 overflow-hidden rounded-full"
        style={{ opacity: 0.7 }}
      >
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: `${pct}%`, background: 'var(--mc-surface)', borderColor: 'var(--mc-fg)' }}
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5">
        <MetricInline
          icon={<Sun className="size-3" strokeWidth={1.8} />}
          accent="var(--mc-warn-fg)"
          label="Kp"
          value={data.solar.kpIndex != null ? data.solar.kpIndex.toFixed(1) : '—'}
          sub={kpSub(data.solar.kpIndex, t)}
        />
        <MetricInline label="ΔP" value={data.weather.deltaPressure.toFixed(1)} sub="hPa" />
        <MetricInline label="Wind" value={data.weather.windSpeed.toFixed(1)} sub="m/s" />
        <MetricInline label="Humidity" value={`${data.weather.humidity.toFixed(0)}%`} />
        <MetricInline label="UVI" value={data.weather.uvi.toFixed(1)} />
      </div>

      <div className="mb-3 h-px" style={{ background: 'var(--mc-border)' }} />

      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
        {t('contributing_factors')}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <FactorBar label={t('factor_pressure')} pct={Math.round(data.components.pressureFactor * 100)} />
        <FactorBar label={t('factor_humidity')} pct={Math.round(data.components.humidityFactor * 100)} />
        <FactorBar label={t('factor_temp')} pct={Math.round(data.components.tempFactor * 100)} />
        <FactorBar label={t('factor_wind')} pct={Math.round(data.components.windFactor * 100)} />
        <FactorBar label={t('factor_uv')} pct={Math.round(data.components.uviFactor * 100)} />
        <FactorBar label={t('factor_solar')} pct={Math.round(data.components.solarFactor * 100)} />
      </div>
    </section>
  );
}
