'use client';

import type { Episode } from '@/types/Episode';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CommunityPostEditor } from '@/features/community/CommunityPostEditor';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default function NewCommunityPostPage() {
  const t = useTranslations('Community');
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get('source');
  const episodeIdParam = searchParams.get('episodeId');

  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  // If coming from episode source, load user's recent episodes
  useEffect(() => {
    if (source === 'episode' || episodeIdParam) {
      setLoadingEpisodes(true);
      fetch('/api/episodes?limit=10')
        .then(res => res.json())
        .then((data) => {
          setEpisodes(data.episodes || []);

          // If episodeId is specified, select that episode
          if (episodeIdParam) {
            const ep = (data.episodes || []).find(
              (e: Episode) => e.id === Number.parseInt(episodeIdParam, 10),
            );
            if (ep) {
              setSelectedEpisode(ep);
            }
          }
        })
        .catch(() => {
          // Silently fail
        })
        .finally(() => setLoadingEpisodes(false));
    }
  }, [source, episodeIdParam]);

  const handleSuccess = (postId: string) => {
    router.push(`/dashboard/community/${postId}`);
  };

  const handleCancel = () => {
    router.push('/dashboard/community');
  };

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/community">
            <ArrowLeft className="mr-1.5 size-4" />
            {t('back_to_feed')}
          </Link>
        </Button>
      </div>

      <TitleBar
        title={selectedEpisode ? t('share_with_community') : t('new_post_button')}
      />

      <div className="mx-auto max-w-2xl">
        {/* Episode selector when sharing from episode source */}
        {source === 'episode' && !selectedEpisode && (
          <div className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-medium">{t('select_episode_to_share')}</h3>
            {loadingEpisodes
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
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => setSelectedEpisode(ep)}
                          className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted"
                        >
                          <div>
                            <p className="font-medium">
                              {new Date(ep.startTime).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t('episode_intensity', { intensity: ep.intensity })}
                              {ep.isOngoing ? ` • ${t('episode_ongoing')}` : null}
                            </p>
                          </div>
                          <span className="text-primary">
                            {t('select_episode_action')}
                            {' '}
                            →
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                : (
                    <p className="text-sm text-muted-foreground">
                      {t('no_episodes_to_share')}
                    </p>
                  )}

            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.push('/dashboard/community/new')}
            >
              {t('or_create_general_post')}
            </Button>
          </div>
        )}

        {/* Show editor if no episode source or if episode is selected */}
        {(source !== 'episode' || selectedEpisode) && (
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <CommunityPostEditor
              episode={selectedEpisode}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
          </div>
        )}
      </div>
    </>
  );
}
