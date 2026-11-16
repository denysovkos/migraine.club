'use client';

import { format } from 'date-fns';
import { enUS, fr, uk } from 'date-fns/locale';
import { AlertTriangle, Sun, X, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type SolarForecastData = {
  hasAlert: boolean;
  level: 'warning' | 'danger' | null;
  kpIndex: number | null;
  timestampUtc: string | null;
  message: string | null;
};

export function SolarForecastAlert() {
  const t = useTranslations('ForecastAlert');
  const locale = useLocale();
  const [data, setData] = useState<SolarForecastData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user has dismissed the alert in this session
    const dismissedUntil = sessionStorage.getItem('solarAlertDismissed');
    if (dismissedUntil) {
      const dismissedTime = new Date(dismissedUntil);
      if (dismissedTime > new Date()) {
        setDismissed(true);
        setLoading(false);
        return;
      }
    }

    async function fetchForecast() {
      try {
        const response = await fetch('/api/weather-pain-index/forecast');
        if (response.ok) {
          const forecastData = await response.json();
          setData(forecastData);
        }
      } catch {
        // Silently fail - alerts are optional
      } finally {
        setLoading(false);
      }
    }

    fetchForecast();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    // Dismiss for 6 hours
    const dismissUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
    sessionStorage.setItem('solarAlertDismissed', dismissUntil.toISOString());
  };

  if (loading || dismissed || !data?.hasAlert) {
    return null;
  }

  const isDanger = data.level === 'danger';
  const bgColor = isDanger
    ? 'bg-gradient-to-r from-red-500/15 to-orange-500/15 border-red-500/30'
    : 'bg-gradient-to-r from-amber-500/15 to-yellow-500/15 border-amber-500/30';
  const iconColor = isDanger ? 'text-red-500' : 'text-amber-500';
  const textColor = isDanger ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300';

  const dateFnsLocale = locale === 'fr' ? fr : locale === 'uk' ? uk : enUS;
  const formattedTime = data.timestampUtc
    ? format(new Date(data.timestampUtc), 'MMM d, HH:mm', { locale: dateFnsLocale })
    : null;

  return (
    <div className={`relative overflow-hidden rounded-xl border p-4 ${bgColor}`}>
      {/* Background decoration */}
      <div className="absolute right-0 top-0 opacity-10">
        <Sun className="size-32 -translate-y-8 translate-x-8" />
      </div>

      <div className="relative flex items-start gap-4">
        <div className={`flex size-12 shrink-0 items-center justify-center rounded-full ${isDanger ? 'bg-red-500/20' : 'bg-amber-500/20'}`}>
          {isDanger
            ? (
                <Zap className={`size-6 ${iconColor}`} />
              )
            : (
                <AlertTriangle className={`size-6 ${iconColor}`} />
              )}
        </div>

        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h3 className={`font-semibold ${textColor}`}>
                {isDanger ? t('title') : t('activity_title')}
              </h3>
              <p className={`mt-1 text-sm ${textColor}`}>
                {data.message ? t(data.message as any) : null}
                {data.message ? ' — ' : null}
                {t('migraine_risk')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={handleDismiss}
            >
              <X className="size-4" />
              <span className="sr-only">{t('dismiss')}</span>
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <div className={`flex items-center gap-1.5 ${textColor}`}>
              <Sun className="size-4" />
              <span className="font-medium">{t('kp_forecast', { kp: data.kpIndex?.toFixed(1) ?? '—' })}</span>
            </div>

            {formattedTime && (
              <div className={`text-sm opacity-70 ${textColor}`}>
                {t('observed_time', { time: formattedTime })}
              </div>
            )}
          </div>

          <p className={`mt-2 text-xs opacity-70 ${textColor}`}>
            {t('prepare_message')}
          </p>
        </div>
      </div>
    </div>
  );
}
