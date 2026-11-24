'use client';

import { MessageSquarePlus, PenSquare, SortAsc, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CommunityPostCard } from '@/features/community/CommunityPostCard';
import { CommunitySidebar } from '@/features/community/CommunitySidebar';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { useCommunityFeed } from '@/hooks/useCommunity';
import { cn } from '@/utils/Helpers';

export default function CommunityFeedPage() {
  const t = useTranslations('Community');
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedOnlyOwn, setSelectedOnlyOwn] = useState<boolean>(false);

  const { posts, loading, error, refetch } = useCommunityFeed({
    sort,
    tag: selectedTag,
    limit: 20,
    selectedOnlyOwn,
  });

  return (
    <>
      <TitleBar title={t('feed_title')} description={t('feed_description')} />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Main feed column */}
        <main className="flex-1 space-y-4">
          {/* Create post card */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquarePlus className="size-5" />
              </div>
              <div className="flex-1">
                <p className="mb-3 text-sm text-muted-foreground">
                  {t('create_post_placeholder')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href="/dashboard/community/new">
                      <PenSquare className="mr-1.5 size-4" />
                      {t('new_post_button')}
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/dashboard/community/new?source=episode">
                      {t('share_episode_button')}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2">
            <Button
              variant={sort === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSort('new')}
              className={cn(sort === 'new' && 'pointer-events-none')}
            >
              <SortAsc className="mr-1.5 size-4" />
              {t('sort_new')}
            </Button>
            <Button
              variant={sort === 'top' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSort('top')}
              className={cn(sort === 'top' && 'pointer-events-none')}
            >
              <TrendingUp className="mr-1.5 size-4" />
              {t('sort_top')}
            </Button>

            <Button
              variant={selectedOnlyOwn ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedOnlyOwn(!selectedOnlyOwn)}
            >
              {/* only own add translations */}
              Only own
            </Button>

            {selectedTag && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedTag(undefined)}
              >
                {selectedTag}
                {' '}
                ×
              </Button>
            )}
          </div>

          {/* Posts feed */}
          {loading
            ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              )
            : error
              ? (
                  <div className="rounded-xl border bg-destructive/10 p-6 text-center">
                    <p className="text-sm text-destructive">{t('error_loading')}</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={refetch}>
                      {t('loading')}
                    </Button>
                  </div>
                )
              : posts.length === 0
                ? (
                    <div className="rounded-xl border bg-muted/50 p-8 text-center">
                      <MessageSquarePlus className="mx-auto mb-3 size-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('empty_feed')}</p>
                      <Button size="sm" className="mt-4" asChild>
                        <Link href="/dashboard/community/new">{t('new_post_button')}</Link>
                      </Button>
                    </div>
                  )
                : (
                    <div className="space-y-3">
                      {posts.map(post => (
                        <CommunityPostCard key={post.id} post={post} />
                      ))}
                    </div>
                  )}
        </main>

        {/* Sidebar - desktop only, stacks below on mobile */}
        <div className="w-full lg:w-80">
          <div className="lg:sticky lg:top-6">
            <CommunitySidebar
              selectedTag={selectedTag}
              onTagSelect={setSelectedTag}
            />
          </div>
        </div>
      </div>
    </>
  );
}
