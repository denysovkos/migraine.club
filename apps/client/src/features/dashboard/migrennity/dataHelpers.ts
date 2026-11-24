'use client';

import type { Episode } from '@/types/Episode';

export async function fetchOngoingEpisode(): Promise<Episode | null> {
  const res = await fetch('/api/episodes/recent?limit=5', { cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  const data = await res.json().catch(() => ({ episodes: [] }));
  const episodes = (data?.episodes ?? []) as Episode[];
  const ongoing = episodes.find(e => (e as any)?.isOngoing);
  return ongoing ?? null;
}
