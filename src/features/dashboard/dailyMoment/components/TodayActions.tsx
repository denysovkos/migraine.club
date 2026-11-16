'use client';

import { Activity, Pill, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { CycleToggleChip } from '@/features/cycle/CycleToggleChip';
import { setLastAttackType } from '@/features/episodes/attackTypePrefs';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';
import { cn } from '@/utils/Helpers';

function Tile(props: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  const base = cn(
    'flex min-h-12 w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-border/40 active:scale-[0.99]',
  );
  return (
    <button type="button" className={base} onClick={props.onClick}>
      <div className="shrink-0">{props.icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{props.title}</div>
      </div>
    </button>
  );
}

export function TodayActions(props: {
  refreshToken?: number;
  hasOngoingAttack: boolean;
  ongoingAttackType: 'migraine' | 'headache' | null;
  ongoingEpisodeId: number | null;
  onDidLog?: () => void;
}) {
  const router = useRouter();
  const tHome = useTranslations('DashboardHome');
  const tEpisodes = useTranslations('Episodes');
  const [takeOpen, setTakeOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  async function startAttack(attackType: 'migraine' | 'headache') {
    try {
      const res = await fetch('/api/quick-add/episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to start attack');
      }
      setLastAttackType(attackType);
      setStartOpen(false);
      props.onDidLog?.();
      router.refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? 'Failed to start attack' });
    }
  }

  const canStartNew = !props.hasOngoingAttack;
  const canUpgradeToMigraine = props.hasOngoingAttack && props.ongoingAttackType === 'headache';

  return (
    <>
      <div className="space-y-2">
        <div className="px-1 text-sm font-medium text-muted-foreground">
          {tHome('for_today')}
        </div>

        <div className="grid grid-cols-1 gap-2">
          {canStartNew && (
            <Tile
              icon={(
                <div className="flex size-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
                  <Sparkles className="size-5" />
                </div>
              )}
              title={tHome('start_attack')}
              onClick={() => setStartOpen(true)}
            />
          )}

          {canUpgradeToMigraine && (
            <Tile
              icon={(
                <div className="flex size-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
                  <Sparkles className="size-5" />
                </div>
              )}
              title={tHome('upgrade_to_migraine')}
              onClick={() => startAttack('migraine')}
            />
          )}

          <Tile
            icon={(
              <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                <Pill className="size-5" />
              </div>
            )}
            title={tHome('take_medication')}
            onClick={() => setTakeOpen(true)}
          />
        </div>

        <CycleToggleChip />
      </div>

      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={setTakeOpen}
        episodeId={props.hasOngoingAttack ? props.ongoingEpisodeId : null}
        onDidLog={() => props.onDidLog?.()}
      />

      <BottomSheet open={startOpen} onOpenChange={setStartOpen} title={tHome('start_attack_sheet_title')}>
        <div className="space-y-2">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border bg-background px-4 text-left text-sm font-medium hover:bg-muted"
            onClick={() => startAttack('migraine')}
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles className="size-4" />
              {tEpisodes('type_migraine')}
            </span>
            <span className="text-xs text-muted-foreground">{tHome('start_now')}</span>
          </button>

          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border bg-background px-4 text-left text-sm font-medium hover:bg-muted"
            onClick={() => startAttack('headache')}
          >
            <span className="inline-flex items-center gap-2">
              <Activity className="size-4" />
              {tEpisodes('type_headache')}
            </span>
            <span className="text-xs text-muted-foreground">{tHome('start_now')}</span>
          </button>

          <Button type="button" variant="outline" className="mt-2 min-h-11 w-full" onClick={() => setStartOpen(false)}>
            {tHome('cancel')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
