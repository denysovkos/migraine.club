'use client';

import type { CurrentWpiResponse, WpiLevelType } from '@/types/WeatherPainIndex';
import { AlertTriangle, Cloud, Sun, Wind } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

const levelColors: Record<WpiLevelType, string> = {
  low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  very_high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function getKpDescription(kpIndex: number | null, t: ReturnType<typeof useTranslations<'WpiCard'>>): string {
  if (kpIndex === null) {
    return t('kp_no_data');
  }
  if (kpIndex <= 2) {
    return t('kp_quiet');
  }
  if (kpIndex <= 4) {
    return t('kp_unsettled');
  }
  if (kpIndex <= 5) {
    return t('kp_active');
  }
  if (kpIndex <= 7) {
    return t('kp_minor_storm');
  }
  if (kpIndex <= 8) {
    return t('kp_major_storm');
  }
  return t('kp_severe_storm');
}

export function WpiCard() {
  const t = useTranslations('WpiCard');
  const [data, setData] = useState<CurrentWpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsRequired, setSettingsRequired] = useState(false);

  useEffect(() => {
    async function fetchWpi() {
      try {
        const response = await fetch('/api/weather-pain-index/current');
        if (!response.ok) {
          const errorData = await response.json();
          if (errorData.code === 'SETTINGS_NOT_FOUND') {
            setSettingsRequired(true);
            return;
          }
          throw new Error(errorData.error || 'Failed to fetch WPI');
        }
        const wpiData = await response.json();
        setData(wpiData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchWpi();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="animate-pulse">
          <div className="mb-4 h-6 w-48 rounded bg-muted"></div>
          <div className="mb-2 h-16 w-24 rounded bg-muted"></div>
          <div className="h-4 w-32 rounded bg-muted"></div>
        </div>
      </div>
    );
  }

  if (settingsRequired) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Cloud className="mt-1 size-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">{t('title')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('setup_location')}
            </p>
            <Link
              href="/dashboard/settings/location"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              {t('set_up_location_link')}
            </Link>
          </div>
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

  const levelLabels: Record<WpiLevelType, string> = {
    low: t('level_low'),
    moderate: t('level_moderate'),
    high: t('level_high'),
    very_high: t('level_very_high'),
  };

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-lg font-semibold">{t('title')}</h3>
        <Badge className={`shrink-0 ${levelColors[data.level]}`}>{levelLabels[data.level]}</Badge>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-5xl font-bold tabular-nums">{data.score.toFixed(1)}</span>
        <span className="text-2xl text-muted-foreground">/ 10</span>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Sun className="size-4 text-amber-500" />
          <span className="text-muted-foreground">{t('kp_index_label')}</span>
          <span className="font-medium">
            {data.solar.kpIndex !== null ? data.solar.kpIndex.toFixed(1) : 'N/A'}
          </span>
          <span className="min-w-0 break-words text-muted-foreground">
            (
            {getKpDescription(data.solar.kpIndex, t)}
            )
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('delta_pressure_label')}</span>
            <span className="font-medium">
              {data.weather.deltaPressure.toFixed(1)}
              {' '}
              hPa
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('humidity_label')}</span>
            <span className="font-medium">
              {data.weather.humidity.toFixed(0)}
              %
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Wind className="size-4 text-sky-500" />
            <span className="font-medium">
              {data.weather.windSpeed.toFixed(1)}
              {' '}
              m/s
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('uvi_label')}</span>
            <span className="font-medium">{data.weather.uvi.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
          {t('contributing_factors')}
        </h4>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <FactorBar label={t('factor_pressure')} value={data.components.pressureFactor} />
          <FactorBar label={t('factor_humidity')} value={data.components.humidityFactor} />
          <FactorBar label={t('factor_temp')} value={data.components.tempFactor} />
          <FactorBar label={t('factor_wind')} value={data.components.windFactor} />
          <FactorBar label={t('factor_uv')} value={data.components.uviFactor} />
          <FactorBar label={t('factor_solar')} value={data.components.solarFactor} />
        </div>
      </div>
    </div>
  );
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const percentage = Math.round(value * 100);
  const colorClass
    = value < 0.33
      ? 'bg-emerald-500'
      : value < 0.66
        ? 'bg-amber-500'
        : 'bg-red-500';

  return (
    <div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <span>
          {percentage}
          %
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${colorClass} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
