'use client';

import type { Episode } from '@/types/Episode';
import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import { PainLevelBadge } from '@/components/PainLevelBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { AttackTypeBadge } from './components/AttackTypeBadge';
import { EpisodeFactorSummary } from './EpisodeFactorSummary';
import { EpisodesTable } from './EpisodesTable';

type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE = 10;

function EpisodeCard({ episode, onClick }: { episode: Episode; onClick: () => void }) {
  const t = useTranslations('EpisodesTable');
  const date = new Date(episode.startTime);
  const isToday = new Date().toDateString() === date.toDateString();

  // Calculate duration if we have end time
  let durationText = '-';
  if (episode.isOngoing) {
    durationText = t('ongoing');
  } else if (episode.endTime) {
    const start = new Date(episode.startTime);
    const end = new Date(episode.endTime);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      durationText = `${hours}h ${minutes}m`;
    } else {
      durationText = `${minutes}m`;
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/50 active:scale-[0.98] active:bg-muted"
      aria-label={t('view')}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {isToday
              ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(date, { addSuffix: true })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <AttackTypeBadge episode={episode} />
          {episode.isOngoing
            ? (
                <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  <Clock className="size-3" />
                  {t('ongoing')}
                </Badge>
              )
            : (
                <span className="text-sm text-muted-foreground">{durationText}</span>
              )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <PainLevelBadge value={episode.intensity} />
        <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      <div className="border-t pt-3">
        <EpisodeFactorSummary episode={episode} />
      </div>
    </button>
  );
}

function PaginationControls({
  pagination,
  onPageChange,
  isLoading,
}: {
  pagination: PaginationInfo;
  onPageChange: (page: number) => void;
  isLoading: boolean;
}) {
  const t = useTranslations('EpisodesList');

  const canGoPrevious = pagination.page > 1;
  const canGoNext = pagination.page < pagination.totalPages;

  return (
    <div className="flex items-center justify-between gap-4 pt-4">
      <Button
        variant="outline"
        size="lg"
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={!canGoPrevious || isLoading}
        className="min-h-12 min-w-24 gap-2"
      >
        <ChevronLeft className="size-4" />
        <span className="hidden sm:inline">{t('previous')}</span>
      </Button>

      <span className="text-sm text-muted-foreground">
        {t('page_of', { page: pagination.page, total: pagination.totalPages })}
      </span>

      <Button
        variant="outline"
        size="lg"
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={!canGoNext || isLoading}
        className="min-h-12 min-w-24 gap-2"
      >
        <span className="hidden sm:inline">{t('next')}</span>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={`skeleton-${String(i)}`} className="h-24 animate-pulse rounded-xl bg-muted md:h-16" />
      ))}
    </div>
  );
}

export function EpisodesList() {
  const t = useTranslations('EpisodesList');
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEpisodes = useCallback(async (page: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/episodes?page=${page}&limit=${PAGE_SIZE}`);
      if (!response.ok) {
        throw new Error('Failed to fetch episodes');
      }
      const data = await response.json();
      setEpisodes(data.episodes || []);
      setPagination(data.pagination || {
        page,
        limit: PAGE_SIZE,
        total: 0,
        totalPages: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEpisodes(1);
  }, [fetchEpisodes]);

  const handlePageChange = (newPage: number) => {
    fetchEpisodes(newPage);
    // Scroll to top when changing pages
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRowClick = (episodeId: number) => {
    router.push(`/dashboard/episodes/${episodeId}`);
  };

  if (loading && episodes.length === 0) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (episodes.length === 0 && pagination.total === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-muted-foreground">{t('no_episodes')}</p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/episodes/new">{t('log_first_episode')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mobile view: Card-based layout */}
      <div className="space-y-3 md:hidden">
        {loading
          ? (
              <LoadingSkeleton />
            )
          : (
              episodes.map(episode => (
                <EpisodeCard
                  key={episode.id}
                  episode={episode}
                  onClick={() => handleRowClick(episode.id)}
                />
              ))
            )}
      </div>

      {/* Desktop view: Table-based layout */}
      <div className="hidden md:block">
        {loading
          ? (
              <LoadingSkeleton />
            )
          : (
              <EpisodesTable episodes={episodes} onRowClick={handleRowClick} />
            )}
      </div>

      {/* Pagination controls */}
      {pagination.totalPages > 1 && (
        <PaginationControls
          pagination={pagination}
          onPageChange={handlePageChange}
          isLoading={loading}
        />
      )}
    </div>
  );
}
