'use client';

import type { Episode } from '@/types/Episode';
import type { WpiLevelType } from '@/types/WeatherPainIndex';
import { format } from 'date-fns';
import { enUS, fr, uk } from 'date-fns/locale';
import { Brain, Calendar, Thermometer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PainLevelBadge } from '@/components/PainLevelBadge';
import { Badge } from '@/components/ui/badge';

type EpisodeWithContext = Episode;

type RecentEpisodesResponse = {
  episodes: EpisodeWithContext[];
};

const levelColors: Record<WpiLevelType, string> = {
  low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  very_high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function getDateFnsLocale(locale: string) {
  return locale === 'fr' ? fr : locale === 'uk' ? uk : enUS;
}

export function LatestEpisodesWithWpi({ limit = 3 }: { limit?: number }) {
  const t = useTranslations('LatestEpisodesWithWpi');
  const [episodes, setEpisodes] = useState<EpisodeWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEpisodes() {
      try {
        const response = await fetch(`/api/episodes/recent?limit=${limit}`);
        if (!response.ok) {
          setError(t('error_fetch'));
          return;
        }
        const data: RecentEpisodesResponse = await response.json();
        setEpisodes(data.episodes);
      } catch (err) {
        console.error(err);
        setError(t('error_generic'));
      } finally {
        setLoading(false);
      }
    }

    fetchEpisodes();
  }, [limit, t]);

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted"></div>
        <div className="space-y-4">
          {Array.from({ length: limit }, (_, i) => `skeleton-${i}`).map(key => (
            <div key={key} className="h-20 animate-pulse rounded bg-muted"></div>
          ))}
        </div>
      </div>
    );
  }

  const levelLabelsShort: Record<WpiLevelType, string> = {
    low: t('level_low'),
    moderate: t('level_moderate'),
    high: t('level_high'),
    very_high: t('level_very_high'),
  };

  if (error) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <p className="mt-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('no_episodes')}
        </p>
        <Link
          href="/dashboard/episodes/new"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t('log_first_episode')}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <Link
          href="/dashboard/episodes"
          className="text-sm text-primary hover:underline"
        >
          {t('view_all')}
        </Link>
      </div>

      <div className="space-y-4">
        {episodes.map(episode => (
          <EpisodeCard key={episode.id} episode={episode} t={t} levelLabels={levelLabelsShort} />
        ))}
      </div>
    </div>
  );
}

function EpisodeCard({ episode, t, levelLabels }: { episode: EpisodeWithContext; t: ReturnType<typeof useTranslations<'LatestEpisodesWithWpi'>>; levelLabels: Record<WpiLevelType, string> }) {
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const startTime = new Date(episode.startTime);
  const wpi = episode.weatherContext as Episode['weatherContext'];

  return (
    <a
      href={`/dashboard/episodes/${episode.id}`}
      className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="size-4" />
          <span className="min-w-0 truncate">{format(startTime, 'MMM d, yyyy HH:mm', { locale: dateFnsLocale })}</span>
        </div>
        {episode.isOngoing && (
          <Badge variant="secondary" className="shrink-0 text-xs">
            {t('ongoing')}
          </Badge>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="size-4 text-primary" />
          <span className="font-semibold">{t('pain_label')}</span>
          <PainLevelBadge value={episode.intensity} />
        </div>

        {wpi && (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Thermometer className="size-4 text-orange-500" />
              <span className="text-sm">
                {t('wpi_label')}
                {' '}
                {wpi.wpiScore.toFixed(1)}
              </span>
              <Badge className={`shrink-0 text-xs ${levelColors[wpi.wpiLevel]}`}>
                {levelLabels[wpi.wpiLevel]}
              </Badge>
            </div>

            {wpi.kpIndex !== null && (
              <div className="text-sm text-muted-foreground">
                {t('kp_label')}
                {' '}
                {wpi.kpIndex.toFixed(1)}
              </div>
            )}
          </>
        )}
      </div>

      {wpi && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>
            {t('delta_pressure')}
            {' '}
            {wpi.deltaPressure.toFixed(1)}
            {' '}
            hPa
          </span>
          <span>•</span>
          <span>
            {t('humidity')}
            {' '}
            {wpi.humidity.toFixed(0)}
            %
          </span>
          <span>•</span>
          <span>
            {t('temp_swing')}
            {' '}
            {wpi.temperatureDeviation.toFixed(1)}
            °C
          </span>
        </div>
      )}
    </a>
  );
}
