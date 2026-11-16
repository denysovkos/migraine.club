'use client';

import { ArrowRight, MessageCircle, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCommunityFeed } from '@/hooks/useCommunity';

export function CommunityPreview() {
  const t = useTranslations('DashboardCommunity');
  const tCommunity = useTranslations('Community');
  const { posts, loading } = useCommunityFeed({ sort: 'top', limit: 3 });

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">{t('preview_title')}</h2>
        </div>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/dashboard/community">
            {t('see_all')}
            <ArrowRight className="ml-1 size-4" />
          </Link>
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {t('preview_description')}
      </p>

      {loading
        ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          )
        : posts.length > 0
          ? (
              <div className="space-y-3">
                {posts.map(post => (
                  <Link
                    key={post.id}
                    href={`/dashboard/community/${post.id}`}
                    className="block rounded-lg border p-3 transition-colors hover:bg-muted"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-1 text-sm font-medium">{post.title}</h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {post.bodyPreview}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {post.isFromEpisode && (
                          <Badge variant="secondary" className="text-xs">
                            {tCommunity('from_diary_badge')}
                          </Badge>
                        )}
                        <span className="flex items-center gap-0.5">
                          <MessageCircle className="size-3" />
                          {post.commentCount}
                        </span>
                        <span>
                          ↑
                          {post.score}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          : (
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <MessageCircle className="mx-auto mb-2 size-8 text-muted-foreground" />
                <p className="mb-3 text-sm text-muted-foreground">
                  {tCommunity('empty_feed')}
                </p>
                <Button size="sm" asChild>
                  <Link href="/dashboard/community">{t('join_conversation')}</Link>
                </Button>
              </div>
            )}

      {posts.length > 0 && (
        <div className="mt-4 text-center">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/community">{t('join_conversation')}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
