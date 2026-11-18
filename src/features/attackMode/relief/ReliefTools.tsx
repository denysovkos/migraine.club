'use client';

import type { ReliefExercise, ReliefHelped } from '@/types/Relief';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';
import { bigButton, bigLabel, bigSub } from '../attackModeStyles';
import { recordReliefSession } from './reliefApi';
import {
  BREATH_COUNT,
  exerciseSteps,
  positionAt,
  RELIEF_EXERCISES,
  RELIEF_HELPED_CHOICES,
  totalMinutes,
} from './reliefExercises';
import { readVoicePref, speak, speechAvailable, stopSpeaking, writeVoicePref } from './speech';

type Mode
  = | { kind: 'menu' }
    | { kind: 'running'; exercise: ReliefExercise; startedAt: number }
    | { kind: 'feedback'; exercise: ReliefExercise; startedAt: number; durationSeconds: number; completed: boolean };

const TICK_MS = 250;

/**
 * Attack mode "Relax": pick an exercise, follow it step by step (optionally
 * read aloud), then say whether it helped. The session is recorded against
 * the ongoing attack when there is one. Same low-stimulus look as the rest
 * of attack mode: no colour, no animation, only text that changes.
 */
export function ReliefTools(props: {
  /** Ongoing attack the session belongs to; null outside an attack or before it has synced. */
  episodeId: number | null;
  onBack: () => void;
  /** Called once the session is recorded (or failed to), with a status line for the footer. */
  onDone: (message: string) => void;
}) {
  const t = useTranslations('ReliefTools');
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  const [now, setNow] = useState(() => Date.now());
  // Only ever rendered after a tap in attack mode, never on the server, so
  // browser APIs can be read during the first render.
  const [canSpeak] = useState(() => speechAvailable());
  const [voice, setVoice] = useState(() => speechAvailable() && readVoicePref());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const running = mode.kind === 'running' ? mode : null;

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const steps = exerciseSteps(running.exercise);
    const id = window.setInterval(() => {
      const at = Date.now();
      if (positionAt(steps, at - running.startedAt).done) {
        // The last step ran out: ask whether it helped.
        setMode({
          kind: 'feedback',
          exercise: running.exercise,
          startedAt: running.startedAt,
          durationSeconds: steps.reduce((sum, s) => sum + s.seconds, 0),
          completed: true,
        });
        return;
      }
      setNow(at);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // Keep the screen on during a session where the browser allows it.
  useEffect(() => {
    if (!running || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return undefined;
    }
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock.request('screen').then((l) => {
      if (cancelled) {
        void l.release().catch(() => {});
      } else {
        lock = l;
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
      void lock?.release().catch(() => {});
    };
  }, [running]);

  const steps = useMemo(() => (running ? exerciseSteps(running.exercise) : []), [running]);
  const position = running ? positionAt(steps, now - running.startedAt) : null;
  const stepIndex = position && !position.done ? position.index : -1;
  const stepKey = position && !position.done ? position.step.key : null;

  // Read each step aloud once, when it starts (or when voice is turned on mid-step).
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voice || !running || !stepKey) {
      return;
    }
    const id = `${running.startedAt}:${stepIndex}`;
    if (spokenRef.current !== id) {
      spokenRef.current = id;
      speak(t(`step_${stepKey}`), locale);
    }
  });

  useEffect(() => {
    if (!running) {
      stopSpeaking();
    }
  }, [running]);

  useEffect(() => () => stopSpeaking(), []);

  function start(exercise: ReliefExercise) {
    const startedAt = Date.now();
    setNow(startedAt);
    setMode({ kind: 'running', exercise, startedAt });
  }

  function stop() {
    if (!running) {
      return;
    }
    setMode({
      kind: 'feedback',
      exercise: running.exercise,
      startedAt: running.startedAt,
      durationSeconds: Math.max(0, (Date.now() - running.startedAt) / 1000),
      completed: false,
    });
  }

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    writeVoicePref(next);
    spokenRef.current = null;
    if (!next) {
      stopSpeaking();
    }
  }

  async function finish(helped: ReliefHelped | null) {
    if (mode.kind !== 'feedback' || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let message: string;
    try {
      const result = await recordReliefSession({
        exercise: mode.exercise,
        startedAt: new Date(mode.startedAt),
        durationSeconds: mode.durationSeconds,
        completed: mode.completed,
        helped,
        episodeId: props.episodeId,
      });
      message = result.queued ? t('status_saved_offline') : t('status_saved');
    } catch (e: unknown) {
      message = e instanceof Error && e.message ? e.message : t('status_error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    props.onDone(message);
  }

  const voiceToggle = (
    <button type="button" className={cn(bigButton, 'min-h-20')} onClick={toggleVoice} aria-pressed={voice}>
      <span className="text-xl">{voice ? t('voice_on') : t('voice_off')}</span>
    </button>
  );

  if (mode.kind === 'feedback') {
    return (
      <div className="flex flex-1 flex-col gap-3" data-testid="relief-feedback">
        <h2 className="text-lg text-neutral-500">{t('helped_title')}</h2>
        {RELIEF_HELPED_CHOICES.map(choice => (
          <button
            key={choice}
            type="button"
            className={cn(bigButton, 'min-h-24 flex-1')}
            onClick={() => finish(choice)}
            disabled={saving}
          >
            <span className={bigLabel}>{t(`helped_${choice}`)}</span>
          </button>
        ))}
        <button type="button" className={cn(bigButton, 'min-h-20')} onClick={() => finish(null)} disabled={saving}>
          <span className="text-xl">{t('helped_skip')}</span>
        </button>
      </div>
    );
  }

  if (running) {
    const current = position && !position.done ? position : null;
    const counted = current && current.step.phase !== 'guide';
    return (
      <div className="flex flex-1 flex-col gap-3" data-testid="relief-session">
        <h2 className="text-lg text-neutral-500">{t(`exercise_${running.exercise}`)}</h2>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2 text-center">
          {current && (
            <>
              <p className="text-3xl font-medium leading-snug text-neutral-300" aria-live="polite" data-testid="relief-step">
                {t(`step_${current.step.key}`)}
              </p>
              {counted && (
                <p className="text-6xl font-light tabular-nums text-neutral-500" aria-hidden="true" data-testid="relief-countdown">
                  {current.secondsLeft}
                </p>
              )}
              {current.step.breath && (
                <p className={bigSub}>{t('breath_count', { n: current.step.breath, total: BREATH_COUNT })}</p>
              )}
            </>
          )}
        </div>
        <div className={cn('grid gap-3', canSpeak ? 'grid-cols-2' : 'grid-cols-1')}>
          {canSpeak && voiceToggle}
          <button type="button" className={cn(bigButton, 'min-h-20')} onClick={stop}>
            <span className="text-xl">{t('stop')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="relief-menu">
      <h2 className="text-lg text-neutral-500">{t('menu_title')}</h2>
      {RELIEF_EXERCISES.map(exercise => (
        <button
          key={exercise}
          type="button"
          className={cn(bigButton, 'min-h-28 flex-1')}
          onClick={() => start(exercise)}
        >
          <span className={bigLabel}>{t(`exercise_${exercise}`)}</span>
          <span className={bigSub}>
            {t('exercise_sub', { minutes: totalMinutes(exercise), description: t(`desc_${exercise}`) })}
          </span>
        </button>
      ))}
      <div className="grid grid-cols-2 gap-3">
        {canSpeak ? voiceToggle : <div />}
        <button type="button" className={cn(bigButton, 'min-h-20')} onClick={props.onBack}>
          <span className="text-xl">{t('back')}</span>
        </button>
      </div>
    </div>
  );
}
