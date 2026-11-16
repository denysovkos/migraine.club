'use client';

import type { Episode } from '@/types/Episode';
import { Activity, MessageSquareText, Pill, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { AttackTimingChip } from '@/features/programs/AttackTimingChip';
import { upsertDoseOutcome } from '@/features/quickAdd/acuteMedsApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { cn } from '@/utils/Helpers';

export function AttackInProgressCard(props: {
  episode: Episode | null;
  loading: boolean;
  refreshToken?: number;
  onDidLog?: () => void;
}) {
  const router = useRouter();
  const tHome = useTranslations('DashboardHome');
  const tEpisodes = useTranslations('Episodes');
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [takeOpen, setTakeOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [treatment, setTreatment] = useState<Episode['attackTreatment'] | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [selectedDoseId, setSelectedDoseId] = useState<string | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);

  useEffect(() => {
    if (!props.episode) {
      setTreatment(null);
      return;
    }
    fetch(`/api/episodes/${props.episode.id}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          return null;
        }
        return res.json();
      })
      .then((data) => {
        setTreatment(data?.attackTreatment ?? null);
      })
      .catch(() => {
        setTreatment(null);
      });
  }, [props.episode, props.refreshToken]);

  if (props.loading || !props.episode) {
    return null;
  }

  const episode = props.episode;
  const start = new Date((episode as any).startTime);
  const startedAt = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const attackType: 'migraine' | 'headache' = (episode.attackType === 'headache' ? 'headache' : 'migraine');
  const Icon = attackType === 'headache' ? Activity : Sparkles;
  const label = attackType === 'headache' ? tEpisodes('type_headache') : tEpisodes('type_migraine');

  async function endAttack() {
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
      props.onDidLog?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setEnding(false);
    }
  }

  async function saveEpisodeNote() {
    setSavingNote(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: note.trim() ? note.trim() : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed');
      }
      setNoteOpen(false);
      props.onDidLog?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setSavingNote(false);
    }
  }

  async function saveOutcome(helped: 'yes' | 'partly' | 'no') {
    if (!selectedDoseId) {
      return;
    }
    setSavingOutcome(true);
    try {
      await upsertDoseOutcome({ doseId: selectedDoseId, helped });
      setOutcomeOpen(false);
      props.onDidLog?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setSavingOutcome(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">{tHome('attack_in_progress_title')}</div>
            <div className="mt-1 inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Icon className="size-4" />
                {label}
              </span>
              <span className="text-muted-foreground/50">·</span>
              <span>{tHome('started_at', { time: startedAt })}</span>
            </div>
            <div className="mt-2">
              <AttackTimingChip attackId={Number(episode.id)} refreshToken={props.refreshToken} />
            </div>
          </div>

          <Button
            type="button"
            className="min-h-11"
            onClick={endAttack}
            disabled={ending}
          >
            {ending ? tHome('ending') : tHome('end_attack')}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-sm font-medium hover:bg-muted/70',
            )}
            onClick={() => setTakeOpen(true)}
          >
            <Pill className="size-4" />
            {tHome('add_medication')}
          </button>

          <button
            type="button"
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-sm font-medium hover:bg-muted/70',
            )}
            onClick={() => {
              setNote(((episode as any).notes ?? '') as string);
              setNoteOpen(true);
            }}
          >
            <MessageSquareText className="size-4" />
            {tHome('add_note')}
          </button>

          <Link
            href={`/dashboard/episodes/${episode.id}`}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full bg-muted px-3 text-sm font-medium hover:bg-muted/70',
            )}
          >
            {tHome('edit_details')}
          </Link>
        </div>

        {(treatment?.doses?.length ?? 0) > 0 && (
          <div className="mt-3 space-y-2">
            {treatment!.doses.map((dose) => {
              const doseSuffix = [dose.dose, dose.unit].filter(Boolean).join(' ');
              const outcomeLabel = dose.outcome?.helped
                ? `Outcome: ${dose.outcome.helped}`
                : 'Outcome';
              return (
                <div key={dose.doseId} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{dose.medicationLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {doseSuffix || 'Dose logged'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-background"
                    onClick={() => {
                      setSelectedDoseId(dose.doseId);
                      setOutcomeOpen(true);
                    }}
                  >
                    {outcomeLabel}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={setTakeOpen}
        episodeId={episode.id}
        onDidLog={() => {
          props.onDidLog?.();
          router.refresh();
        }}
      />

      <BottomSheet open={noteOpen} onOpenChange={setNoteOpen} title={tHome('note_sheet_title')}>
        <div className="space-y-3">
          <textarea
            className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={tHome('note_placeholder')}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setNoteOpen(false)}>
              {tHome('cancel')}
            </Button>
            <Button type="button" className="min-h-11" onClick={saveEpisodeNote} disabled={savingNote}>
              {savingNote ? tHome('saving') : tHome('save')}
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={outcomeOpen} onOpenChange={setOutcomeOpen} title={tHome('acute_outcome_sheet_title')}>
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">{tHome('acute_outcome_prompt')}</div>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" disabled={savingOutcome} onClick={() => saveOutcome('yes')}>
              {tHome('acute_helped_yes')}
            </Button>
            <Button type="button" variant="outline" disabled={savingOutcome} onClick={() => saveOutcome('partly')}>
              {tHome('acute_helped_partly')}
            </Button>
            <Button type="button" variant="outline" disabled={savingOutcome} onClick={() => saveOutcome('no')}>
              {tHome('acute_helped_no')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
