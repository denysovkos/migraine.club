'use client';

import type { Episode } from '@/types/Episode';

import { useEffect, useMemo, useState } from 'react';
import { IntakeResumeTile } from '@/features/intake/IntakeResumeTile';

import { AcuteMedTimingStatusCard } from './components/AcuteMedTimingStatusCard';
import { AttackInProgressCard } from './components/AttackInProgressCard';
import { MohGuardrailBanner } from './components/MohGuardrailBanner';
import { PinnedMedsQuickKit } from './components/PinnedMedsQuickKit';
import { PreventivesDueStrip } from './components/PreventivesDueStrip';
import { ProgramDailyChip } from './components/ProgramDailyChip';
import { ProgramSuggestionTile } from './components/ProgramSuggestionTile';
import { TodayActions } from './components/TodayActions';
import { TodayMomentCard } from './components/TodayMomentCard';

async function fetchOngoingEpisode(): Promise<Episode | null> {
  const res = await fetch('/api/episodes/recent?limit=5', { cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  const data = await res.json().catch(() => ({ episodes: [] }));
  const episodes = (data?.episodes ?? []) as Episode[];
  const ongoing = episodes.find(e => (e as any)?.isOngoing);
  return ongoing ?? null;
}

export function DailyMomentStack(props: { refreshToken?: number; onDidLog?: () => void }) {
  const [ongoing, setOngoing] = useState<Episode | null>(null);
  const [loadingOngoing, setLoadingOngoing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingOngoing(true);
    fetchOngoingEpisode()
      .then((ep) => {
        if (cancelled) {
          return;
        }
        setOngoing(ep);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoadingOngoing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshToken]);

  const hasOngoing = useMemo(() => !!ongoing, [ongoing]);
  const ongoingId = ongoing ? (ongoing as any).id : null;
  // IMPORTANT: attackType is optional for backward compatibility; if missing, treat as migraine.
  const ongoingAttackType = (hasOngoing
    ? ((ongoing?.attackType ?? 'migraine') as ('migraine' | 'headache'))
    : null);

  return (
    <div className="space-y-3">
      <IntakeResumeTile />

      <ProgramSuggestionTile />

      <TodayMomentCard
        refreshToken={props.refreshToken}
        hasOngoingAttack={hasOngoing}
        ongoingAttackType={ongoingAttackType}
        onDidLog={props.onDidLog}
      />

      <AttackInProgressCard
        refreshToken={props.refreshToken}
        episode={ongoing}
        loading={loadingOngoing}
        onDidLog={props.onDidLog}
      />

      <TodayActions
        refreshToken={props.refreshToken}
        hasOngoingAttack={hasOngoing}
        ongoingAttackType={ongoingAttackType}
        ongoingEpisodeId={ongoingId}
        onDidLog={props.onDidLog}
      />

      <PreventivesDueStrip
        refreshToken={props.refreshToken}
        onDidLog={props.onDidLog}
      />

      <ProgramDailyChip />

      <AcuteMedTimingStatusCard />

      <PinnedMedsQuickKit
        refreshToken={props.refreshToken}
        onDidLog={props.onDidLog}
      />
      <MohGuardrailBanner refreshToken={props.refreshToken} />
    </div>
  );
}
