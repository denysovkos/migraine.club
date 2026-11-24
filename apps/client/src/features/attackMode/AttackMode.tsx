'use client';

import type { AttackModeOngoing } from './attackModeApi';
import type { AttackPainChoice } from './attackModeLogic';
import type { QuickAddSuggestion } from '@/types/Medications';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteEpisode,
  quickAddCreateIntake,
  quickAddStartEpisodeNow,
  quickAddUndoIntake,
} from '@/features/quickAdd/quickAddApi';
import { removeOutboxItem } from '@/libs/offline/outbox';
import { cn } from '@/utils/Helpers';
import { endAttackNow, fetchAttackModeState, setAttackPain } from './attackModeApi';
import { ATTACK_PAIN_CHOICES, formatDose, intensityToPainChoice, painChoiceToIntensity } from './attackModeLogic';
import { bigButton, bigLabel, bigSub } from './attackModeStyles';
import { ReliefTools } from './relief/ReliefTools';

/** Ongoing attack as attack mode knows it. `id` is null while the start waits in the offline queue. */
type Ongoing = Omit<AttackModeOngoing, 'id'> & { id: number | null };

type Status = { message: string; undo?: () => Promise<void> };

type View = 'home' | 'meds' | 'pain' | 'relief';

export function AttackMode() {
  const t = useTranslations('AttackMode');
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [consentRequired, setConsentRequired] = useState(false);
  const [ongoing, setOngoing] = useState<Ongoing | null>(null);
  const [meds, setMeds] = useState<QuickAddSuggestion[]>([]);
  const [view, setView] = useState<View>('home');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchAttackModeState({ signal: controller.signal })
      .then((state) => {
        if (state.status === 'consent_required') {
          setConsentRequired(true);
          return;
        }
        setOngoing(state.ongoing);
        setMeds(state.meds);
      })
      .catch(() => {
        // Offline or failing reads: still offer starting an attack.
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const formatTime = useCallback(
    (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  // One write at a time: a second tap while the first is in flight is ignored.
  async function run(task: () => Promise<void>) {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } catch (e: unknown) {
      setStatus({ message: e instanceof Error && e.message ? e.message : t('error_generic') });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function startAttack() {
    return run(async () => {
      const startedAt = new Date().toISOString();
      try {
        const result = await quickAddStartEpisodeNow();
        if (result.queued) {
          setOngoing({ id: null, startTime: startedAt, intensity: null });
          setStatus({
            message: t('status_started_offline'),
            undo: async () => {
              await removeOutboxItem(result.outboxId);
              setOngoing(null);
              setStatus({ message: t('status_undone') });
            },
          });
          return;
        }
        const episodeId = result.episodeId;
        setOngoing({ id: episodeId, startTime: startedAt, intensity: null });
        setStatus({
          message: t('status_started', { time: formatTime(startedAt) }),
          undo: async () => {
            await deleteEpisode(episodeId);
            setOngoing(null);
            setStatus({ message: t('status_undone') });
          },
        });
      } catch (e: unknown) {
        const err = e as { code?: string; ongoing?: { episodeId?: number } };
        if (err?.code === 'ONGOING_EXISTS' && typeof err.ongoing?.episodeId === 'number') {
          setOngoing({ id: err.ongoing.episodeId, startTime: startedAt, intensity: null });
          setStatus({ message: t('status_already_running') });
          return;
        }
        throw e;
      }
    });
  }

  function endAttack() {
    const id = ongoing?.id;
    if (!id) {
      return undefined;
    }
    return run(async () => {
      const result = await endAttackNow(id);
      setOngoing(null);
      setView('home');
      setStatus({ message: result.queued ? t('status_ended_offline') : t('status_ended') });
    });
  }

  function takeMed(med: QuickAddSuggestion) {
    return run(async () => {
      const result = await quickAddCreateIntake(
        {
          userMedicationId: med.userMedicationId,
          ...(med.suggestedDose ? { dose: med.suggestedDose } : {}),
          ...(med.suggestedUnit ? { unit: med.suggestedUnit } : {}),
          ...(med.unitIsCustom ? { unitIsCustom: true } : {}),
          ...(ongoing?.id ? { episodeId: ongoing.id } : {}),
          recordAcuteDose: true,
        },
        { label: med.label },
      );
      setView('home');
      if (result.queued) {
        setStatus({
          message: t('status_med_logged_offline', { name: med.label }),
          undo: async () => {
            await removeOutboxItem(result.outboxId);
            setStatus({ message: t('status_undone') });
          },
        });
        return;
      }
      const intakeId = result.intakeId;
      setStatus({
        message: t('status_med_logged', { name: med.label }),
        undo: async () => {
          await quickAddUndoIntake(intakeId);
          setStatus({ message: t('status_undone') });
        },
      });
    });
  }

  function savePain(choice: AttackPainChoice) {
    const id = ongoing?.id;
    if (!id) {
      return undefined;
    }
    return run(async () => {
      const result = await setAttackPain(id, choice);
      setOngoing(prev => (prev ? { ...prev, intensity: painChoiceToIntensity(choice) } : prev));
      setView('home');
      const label = t(`pain_${choice}`);
      setStatus({ message: result.queued ? t('status_pain_saved_offline', { level: label }) : t('status_pain_saved', { level: label }) });
    });
  }

  function undoLast() {
    const undo = status?.undo;
    if (!undo) {
      return undefined;
    }
    return run(undo);
  }

  const currentPain = intensityToPainChoice(ongoing?.intensity);
  const waitingForSync = !!ongoing && ongoing.id === null;

  return (
    <div
      className="flex min-h-dvh flex-col bg-black px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),12px)] text-neutral-400"
      style={{ colorScheme: 'dark' }}
      data-testid="attack-mode"
    >
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-base font-medium text-neutral-500">{t('title')}</h1>
        <Link
          href="/dashboard"
          className="flex min-h-12 min-w-12 items-center justify-center rounded-2xl px-4 text-base text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-500"
        >
          {t('exit')}
        </Link>
      </header>

      <main className="mt-3 flex flex-1 flex-col">
        {loading && (
          <p className="m-auto text-lg text-neutral-500">{t('loading')}</p>
        )}

        {!loading && consentRequired && (
          <div className="m-auto max-w-sm space-y-4 text-center">
            <p className="text-lg">{t('consent_required')}</p>
            <Link href="/dashboard" className={cn(bigButton, 'min-h-24')}>
              <span className={bigLabel}>{t('open_app')}</span>
            </Link>
          </div>
        )}

        {!loading && !consentRequired && view === 'home' && (
          <div className="grid flex-1 grid-rows-4 gap-3">
            {ongoing
              ? (
                  <button
                    type="button"
                    className={bigButton}
                    onClick={endAttack}
                    disabled={busy || waitingForSync}
                  >
                    <span className={bigLabel}>{t('end_attack')}</span>
                    <span className={bigSub}>
                      {waitingForSync
                        ? t('waiting_for_sync')
                        : t('started_at', { time: formatTime(ongoing.startTime) })}
                    </span>
                  </button>
                )
              : (
                  <button type="button" className={bigButton} onClick={startAttack} disabled={busy}>
                    <span className={bigLabel}>{t('start_attack')}</span>
                    <span className={bigSub}>{t('start_attack_sub')}</span>
                  </button>
                )}

            <button type="button" className={bigButton} onClick={() => setView('meds')} disabled={busy}>
              <span className={bigLabel}>{t('took_medication')}</span>
              <span className={bigSub}>{t('took_medication_sub')}</span>
            </button>

            <button
              type="button"
              className={bigButton}
              onClick={() => setView('pain')}
              disabled={busy || !ongoing || waitingForSync}
            >
              <span className={bigLabel}>{t('pain_level')}</span>
              <span className={bigSub}>
                {!ongoing
                  ? t('pain_level_needs_attack')
                  : waitingForSync
                    ? t('waiting_for_sync')
                    : currentPain
                      ? t('pain_level_current', { level: t(`pain_${currentPain}`) })
                      : t('pain_level_sub')}
              </span>
            </button>

            <button type="button" className={bigButton} onClick={() => setView('relief')} disabled={busy}>
              <span className={bigLabel}>{t('relax')}</span>
              <span className={bigSub}>{t('relax_sub')}</span>
            </button>
          </div>
        )}

        {!loading && !consentRequired && view === 'relief' && (
          <ReliefTools
            episodeId={ongoing?.id ?? null}
            onBack={() => setView('home')}
            onDone={(message) => {
              setView('home');
              setStatus({ message });
            }}
          />
        )}

        {!loading && !consentRequired && view === 'meds' && (
          <div className="flex flex-1 flex-col gap-3">
            <h2 className="text-lg text-neutral-500">{t('meds_title')}</h2>
            {meds.length === 0 && (
              <p className="py-6 text-lg">{t('meds_empty')}</p>
            )}
            {meds.map((med) => {
              const dose = formatDose(med.suggestedDose, med.suggestedUnit);
              return (
                <button
                  key={med.userMedicationId}
                  type="button"
                  className={cn(bigButton, 'min-h-28 flex-1')}
                  onClick={() => takeMed(med)}
                  disabled={busy}
                >
                  <span className={bigLabel}>{med.label}</span>
                  {dose && <span className={bigSub}>{dose}</span>}
                </button>
              );
            })}
            <button type="button" className={cn(bigButton, 'min-h-20')} onClick={() => setView('home')} disabled={busy}>
              <span className="text-xl">{t('back')}</span>
            </button>
          </div>
        )}

        {!loading && !consentRequired && view === 'pain' && (
          <div className="flex flex-1 flex-col gap-3">
            <h2 className="text-lg text-neutral-500">{t('pain_title')}</h2>
            {ATTACK_PAIN_CHOICES.map(choice => (
              <button
                key={choice}
                type="button"
                className={cn(bigButton, 'min-h-28 flex-1')}
                onClick={() => savePain(choice)}
                disabled={busy}
                aria-pressed={currentPain === choice}
              >
                <span className={bigLabel}>{t(`pain_${choice}`)}</span>
              </button>
            ))}
            <button type="button" className={cn(bigButton, 'min-h-20')} onClick={() => setView('home')} disabled={busy}>
              <span className="text-xl">{t('back')}</span>
            </button>
          </div>
        )}
      </main>

      <footer className="mt-3 flex min-h-16 items-center justify-between gap-3">
        <p className="min-w-0 text-base text-neutral-500" role="status" aria-live="polite">
          {status?.message ?? (!loading && !consentRequired ? t('details_later') : '')}
        </p>
        {status?.undo && (
          <button
            type="button"
            className="flex min-h-12 shrink-0 items-center rounded-2xl border border-neutral-800 px-5 text-base text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-500"
            onClick={undoLast}
            disabled={busy}
          >
            {t('undo')}
          </button>
        )}
      </footer>
    </div>
  );
}
