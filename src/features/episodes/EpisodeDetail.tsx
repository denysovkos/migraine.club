'use client';

import type { Episode } from '@/types/Episode';
import { MessageCircle, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchCycleContext } from '@/features/cycle/cycleApi';
import { useEpisodeSharedStatus } from '@/hooks/useCommunity';

import { AttackTypeBadge } from './components/AttackTypeBadge';
import { EpisodeForm } from './EpisodeForm';

type EpisodeDetailProps = {
  episodeId: number;
};

export function EpisodeDetail({ episodeId }: EpisodeDetailProps) {
  const router = useRouter();
  const t = useTranslations('EpisodeDetail');
  const tCommunity = useTranslations('Community');
  const tWpi = useTranslations('WeatherPainIndex');
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cycleContext, setCycleContext] = useState<{
    enabled: boolean;
    cycleDay: number | null;
    withinPerimenstrualWindow: boolean;
  } | null>(null);

  const { sharedPostId, isShared, loading: sharedLoading } = useEpisodeSharedStatus(episodeId);

  async function fetchEpisode() {
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 404) {
          setError(t('not_found'));
        } else {
          throw new Error(t('load_error'));
        }
        return;
      }
      const data = await response.json();
      setEpisode(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('load_error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEpisode();
    // eslint-disable-next-line react/exhaustive-deps
  }, [episodeId, t]);

  useEffect(() => {
    if (!episode?.startTime) {
      return;
    }
    const localDate = new Date(episode.startTime).toISOString().slice(0, 10);
    fetchCycleContext(localDate)
      .then((ctx) => {
        setCycleContext({
          enabled: ctx.enabled,
          cycleDay: ctx.cycleDay,
          withinPerimenstrualWindow: ctx.withinPerimenstrualWindow,
        });
      })
      .catch(() => {
        setCycleContext(null);
      });
  }, [episode?.startTime]);

  const handleDelete = async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(t('delete_confirm'))) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(t('delete_error'));
      }

      router.push('/dashboard/episodes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('delete_error'));
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground">{t('loading')}</div>
    );
  }

  if (error || !episode) {
    return (
      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
        {error || t('not_found')}
      </div>
    );
  }

  const wpi = episode.weatherContext;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{t('title')}</div>
        <AttackTypeBadge episode={episode} />
      </div>
      {/* Community sharing section */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{tCommunity('nav_title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isShared
                ? tCommunity('already_shared')
                : 'Share your experience with others who understand.'}
            </p>
          </div>
          {!sharedLoading && (
            isShared
              ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1.5">
                      <MessageCircle className="size-3" />
                      {tCommunity('already_shared')}
                    </Badge>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/dashboard/community/${sharedPostId}`}>
                        <MessageCircle className="mr-1.5 size-4" />
                        {tCommunity('view_community_discussion')}
                      </Link>
                    </Button>
                  </div>
                )
              : (
                  <Button size="sm" asChild>
                    <Link href={`/dashboard/community/new?episodeId=${episodeId}`}>
                      <Share2 className="mr-1.5 size-4" />
                      {tCommunity('share_with_community')}
                    </Link>
                  </Button>
                )
          )}
        </div>
      </div>

      {/* Weather context */}
      <div className="space-y-3">
        {cycleContext?.enabled && (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <div className="font-medium">{t('cycle_context_title')}</div>
            <div className="mt-1 text-muted-foreground">
              {cycleContext.cycleDay
                ? t('cycle_context_day', { day: cycleContext.cycleDay })
                : t('cycle_context_unknown')}
              {cycleContext.withinPerimenstrualWindow ? ` · ${t('cycle_context_window')}` : ''}
            </div>
            <div className="mt-2">
              <Button asChild size="sm" variant="outline" className="min-h-11">
                <Link href="/dashboard/diary">{t('cycle_context_edit')}</Link>
              </Button>
            </div>
          </div>
        )}
        {wpi
          ? (
              <div className="rounded-lg border bg-card p-4 text-sm">
                <div className="font-medium">
                  {t('wpi_title')}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {t('wpi_value', {
                    level: tWpi(`level_${wpi.wpiLevel}` as any),
                    score: wpi.wpiScore.toFixed(1),
                  })}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('wpi_metrics', {
                    deltaPressure: wpi.deltaPressure.toFixed(1),
                    humidity: wpi.humidity.toFixed(0),
                  })}
                </div>
              </div>
            )
          : (
              <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
                {t('wpi_no_data')}
              </div>
            )}
      </div>

      <EpisodeForm
        episode={episode}
        onSuccess={() => {
          router.push('/dashboard/episodes');
          router.refresh();
        }}
        onRefreshEpisode={() => fetchEpisode()}
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
