'use client';

import type { Episode } from '@/types/Episode';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { PainLevelBadge } from '@/components/PainLevelBadge';
import { Button } from '@/components/ui/button';

export function OngoingEpisodeBanner({ refreshToken = 0 }: { refreshToken?: number }) {
  const t = useTranslations('episodes.ongoingBanner');
  const router = useRouter();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchEpisodes() {
      setLoading(true);
      try {
        const res = await fetch('/api/episodes/recent?limit=5', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Failed');
        }
        const data = await res.json();
        const ep: Episode | undefined = (data.episodes || []).find((e: Episode) => e.isOngoing);
        if (!cancelled) {
          setEpisode(ep ?? null);
        }
      } catch {
        if (!cancelled) {
          setEpisode(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchEpisodes();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  async function endEpisode() {
    if (!episode) {
      return;
    }
    setEnding(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endNow: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed');
      }
      setEpisode(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setEnding(false);
    }
  }

  if (loading || !episode) {
    return null;
  }

  const start = new Date(episode.startTime);
  const typeLabel = episode.attackType === 'headache'
    ? t('type_headache')
    : t('type_migraine');

  return (
    <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">
            {t('in_progress_since', { time: start.toLocaleString() })}
            {' '}
            <span className="text-muted-foreground">·</span>
            {' '}
            <span className="text-muted-foreground">{typeLabel}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="mr-2">{t('pain_level_label')}</span>
            <PainLevelBadge value={episode.intensity} />
          </div>
          {error && <div className="text-sm text-destructive">{t('error_generic')}</div>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/dashboard/episodes/${episode.id}`}>{t('edit_details')}</Link>
          </Button>
          <Button onClick={endEpisode} disabled={ending}>
            {ending ? t('ending') : t('end_now')}
          </Button>
        </div>
      </div>
    </div>
  );
}
