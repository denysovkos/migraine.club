'use client';

import type { Episode } from '@/types/Episode';

import { useEffect, useMemo, useState } from 'react';
import { HealthDataConsentGuard } from '@/features/consent';
import { MohGuardrailBanner } from '@/features/dashboard/dailyMoment/components/MohGuardrailBanner';
import { ProgramSuggestionTile } from '@/features/dashboard/dailyMoment/components/ProgramSuggestionTile';
import { TodayActions } from '@/features/dashboard/dailyMoment/components/TodayActions';
import { AcuteMedTimingCard } from '@/features/dashboard/migrennity/AcuteMedTimingCard';
import { ConservativeInsightCard } from '@/features/dashboard/migrennity/ConservativeInsightCard';
import { fetchOngoingEpisode } from '@/features/dashboard/migrennity/dataHelpers';
import { HeroCheckInCard } from '@/features/dashboard/migrennity/HeroCheckInCard';
import { PageHeader } from '@/features/dashboard/migrennity/PageHeader';
import { PreventivesCard } from '@/features/dashboard/migrennity/PreventivesCard';
import { QuickKitCard } from '@/features/dashboard/migrennity/QuickKitCard';
import { SleepRegularityCard } from '@/features/dashboard/migrennity/SleepRegularityCard';
import { SolarActivityCard } from '@/features/dashboard/migrennity/SolarActivityCard';
import { TodayTimeline } from '@/features/dashboard/migrennity/TodayTimeline';
import { WeatherPainCard } from '@/features/dashboard/migrennity/WeatherPainCard';
import { PressureOutlookCard } from '@/features/weather/PressureOutlookCard';

const DashboardIndexPage = () => {
  const [episodesRefreshToken, setEpisodesRefreshToken] = useState(0);
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
  }, [episodesRefreshToken]);

  const hasOngoing = useMemo(() => !!ongoing, [ongoing]);
  const ongoingId = ongoing ? (ongoing as any).id : null;
  const ongoingAttackType = (hasOngoing
    ? ((ongoing?.attackType ?? 'migraine') as 'migraine' | 'headache')
    : null);

  const onDidLog = () => setEpisodesRefreshToken(x => x + 1);

  return (
    <HealthDataConsentGuard>
      <PageHeader />

      <div className="mx-auto w-full max-w-6xl space-y-3 pt-2 md:space-y-4">
        {/* Merged hero: 14-day streak strip + today check-in segmented control */}
        <ProgramSuggestionTile />
        <HeroCheckInCard
          refreshToken={episodesRefreshToken}
          hasOngoingAttack={hasOngoing}
          ongoingAttackType={ongoingAttackType}
          onDidLog={onDidLog}
        />

        {/* Today timeline — sleep, meds, attack onset, live "Now" marker */}
        <TodayTimeline
          ongoing={ongoing}
          loadingOngoing={loadingOngoing}
          refreshToken={episodesRefreshToken}
          onDidLog={onDidLog}
        />

        <TodayActions
          refreshToken={episodesRefreshToken}
          hasOngoingAttack={hasOngoing}
          ongoingAttackType={ongoingAttackType}
          ongoingEpisodeId={ongoingId}
          onDidLog={onDidLog}
        />

        {/* Preventives + Sleep + Acute med timing */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <PreventivesCard refreshToken={episodesRefreshToken} onDidLog={onDidLog} />
          <SleepRegularityCard onDidLog={onDidLog} />
          <AcuteMedTimingCard refreshToken={episodesRefreshToken} />
        </div>

        {/* Environment — Weather pain index + Solar Kp */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <WeatherPainCard />
          <SolarActivityCard />
        </div>

        {/* Pressure outlook — multi-day forecast, context not prediction */}
        <PressureOutlookCard />

        {/* Quick kit */}
        <QuickKitCard refreshToken={episodesRefreshToken} onDidLog={onDidLog} />

        <MohGuardrailBanner refreshToken={episodesRefreshToken} />

        {/* Conservative insight */}
        <ConservativeInsightCard refreshToken={episodesRefreshToken} />

        {/* Disclaimer */}
        <p className="py-6 text-center text-[11.5px]" style={{ color: 'var(--mc-fg-faint)' }}>
          Tracking support only. No diagnosis, treatment advice, or predictions.
        </p>
      </div>
    </HealthDataConsentGuard>
  );
};

export default DashboardIndexPage;
