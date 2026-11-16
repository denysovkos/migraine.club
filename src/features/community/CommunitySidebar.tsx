'use client';

import { BarChart3, BookOpen, MessageCircle, TrendingUp, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCommunityStats, useMySharedEpisodes } from '@/hooks/useCommunity';
import { cn } from '@/utils/Helpers';

type CommunitySidebarProps = {
  selectedTag?: string;
  onTagSelect?: (tag: string | undefined) => void;
};

export function CommunitySidebar({ selectedTag, onTagSelect }: CommunitySidebarProps) {
  const t = useTranslations('Community');
  const { stats, loading: statsLoading } = useCommunityStats();
  const { episodes, loading: episodesLoading } = useMySharedEpisodes();

  return (
    <aside className="space-y-4">
      {/* Community Stats Card */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-primary" />
          {t('stats_title')}
        </h3>

        {statsLoading
          ? (
              <div className="space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            )
          : stats && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('stats_posts_today')}</span>
                <span className="font-medium">{stats.postsToday}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('stats_active_users')}</span>
                <span className="font-medium">{stats.activeUsersThisWeek}</span>
              </div>
              {stats.topTagThisWeek && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('stats_top_tag')}</span>
                  <Badge variant="secondary" className="text-xs">
                    {stats.topTagThisWeek}
                  </Badge>
                </div>
              )}
            </div>
          )}
      </div>

      {/* Trending Topics */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-primary" />
          {t('trending_title')}
        </h3>

        {statsLoading
          ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-6 animate-pulse rounded bg-muted" />
                ))}
              </div>
            )
          : stats?.trendingTags && (
            <div className="space-y-1.5">
              {/* All filter */}
              <button
                type="button"
                onClick={() => onTagSelect?.(undefined)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                  !selectedTag
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'hover:bg-muted',
                )}
              >
                <span>{t('filter_all')}</span>
              </button>

              {stats.trendingTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onTagSelect?.(selectedTag === tag ? undefined : tag)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                    selectedTag === tag
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  <span>{tag}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('trending_posts_count', { count })}
                  </span>
                </button>
              ))}
            </div>
          )}
      </div>

      {/* My Shared Episodes */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="size-4 text-primary" />
          {t('my_shared_title')}
        </h3>

        {episodesLoading
          ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 animate-pulse rounded bg-muted" />
                ))}
              </div>
            )
          : episodes.length > 0
            ? (
                <div className="space-y-2">
                  {episodes.map(ep => (
                    <Link
                      key={ep.postId}
                      href={`/dashboard/community/${ep.postId}`}
                      className="block rounded-md p-2 transition-colors hover:bg-muted"
                    >
                      <p className="line-clamp-1 text-sm font-medium">{ep.title}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MessageCircle className="size-3" />
                          {ep.commentCount}
                        </span>
                        <span>
                          ↑
                          {ep.score}
                        </span>
                      </div>
                    </Link>
                  ))}

                  <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
                    <Link href="/dashboard/community?mine=true">
                      {t('my_shared_view_all')}
                    </Link>
                  </Button>
                </div>
              )
            : (
                <p className="text-sm text-muted-foreground">{t('my_shared_empty')}</p>
              )}
      </div>

      {/* Community Guidelines */}
      <div className="rounded-xl border bg-muted/50 p-4">
        <Link
          href="/community/guidelines"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Users className="size-4" />
          {t('guidelines_link')}
        </Link>
      </div>
    </aside>
  );
}
