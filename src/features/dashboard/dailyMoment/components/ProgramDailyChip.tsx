'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { fetchTodayDiary } from '@/features/diary/diaryApi';
import { fetchProgramDetail, fetchProgramSettings, logSleepAdherence } from '@/features/programs/programsApi';
import { showSnackbar } from '@/features/snackbar';
import { cn } from '@/utils/Helpers';

type Selection = 'on_target' | 'off_track' | 'skip' | null;

type ChipState
  = | { kind: 'idle' }
    | {
      kind: 'ready';
      target: { bedTime: string; wakeTime: string };
      today: string;
      hasDayEntry: boolean;
      selection: Selection;
    };

/**
 * Map server-side adherence signal + payload back to the chip's tri-state.
 * - hit  → on_target  (we logged target times)
 * - miss → off_track  (we logged actual times outside tolerance)
 * - na   → skip       (we explicitly logged null/null)
 */
function selectionFromAdherence(
  signal: 'hit' | 'miss' | 'na' | null,
  payload: { bedTime?: string | null; wakeTime?: string | null } | null,
): Selection {
  if (!signal) {
    return null;
  }
  if (signal === 'hit') {
    return 'on_target';
  }
  if (signal === 'miss') {
    return 'off_track';
  }
  // signal === 'na'. Distinguish "user tapped Skip" from "stale na with no payload".
  if (payload && payload.bedTime === null && payload.wakeTime === null) {
    return 'skip';
  }
  return null;
}

export function ProgramDailyChip() {
  const t = useTranslations('ProgramDailyChip');
  const router = useRouter();
  const [state, setState] = useState<ChipState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await fetchProgramSettings().catch(() => null);
      if (cancelled || !settings?.enabled) {
        return;
      }
      const detail = await fetchProgramDetail('sleep-regularity').catch(() => null);
      if (cancelled || !detail?.activeEnrollment) {
        return;
      }
      const target = detail.activeEnrollment.targetPayload as { bedTime: string; wakeTime: string };
      const today = await fetchTodayDiary().catch(() => null);
      if (cancelled || !today) {
        return;
      }
      // Restore selection from today's adherence event (chip writes there, not to diary).
      const todayStatusRes = await fetch(
        '/api/programs/sleep-regularity/today-status',
        { cache: 'no-store' },
      ).catch(() => null);
      const todayStatus = todayStatusRes && todayStatusRes.ok
        ? await todayStatusRes.json().catch(() => null)
        : null;
      if (cancelled) {
        return;
      }
      const selection = selectionFromAdherence(
        todayStatus?.signal ?? null,
        todayStatus?.payload ?? null,
      );
      setState({
        kind: 'ready',
        target,
        today: today.todayLocalDate,
        hasDayEntry: today.entry !== null,
        selection,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind !== 'ready') {
    return null;
  }

  async function tap(value: 'on_target' | 'off_track' | 'skip') {
    if (state.kind !== 'ready' || saving) {
      return;
    }
    // "Off track" needs actual times — route to diary so user can enter them.
    if (value === 'off_track') {
      router.push(`/dashboard/diary?date=${state.today}`);
      return;
    }
    const body
      = value === 'on_target'
        ? { bedTimeLocal: state.target.bedTime, wakeTimeLocal: state.target.wakeTime }
        : { bedTimeLocal: null, wakeTimeLocal: null };
    const optimisticState: ChipState = { ...state, selection: value };
    setState(optimisticState);
    try {
      setSaving(true);
      await logSleepAdherence({ localDate: state.today, ...body });
      showSnackbar({ message: t('saved') });
    } catch {
      showSnackbar({ message: t('save_failed') });
      setState(state);
    } finally {
      setSaving(false);
    }
  }

  const options: { value: 'on_target' | 'off_track' | 'skip'; label: string }[] = [
    { value: 'on_target', label: t('on_target') },
    { value: 'off_track', label: t('off_track') },
    { value: 'skip', label: t('skip') },
  ];

  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
        {t('header', { bed: state.target.bedTime, wake: state.target.wakeTime })}
      </div>
      <div
        className={cn(
          'mt-2 flex items-center rounded-2xl bg-muted p-1',
          saving && 'opacity-70',
        )}
        role="group"
        aria-label={t('header', { bed: state.target.bedTime, wake: state.target.wakeTime })}
      >
        {options.map((opt) => {
          const selected = state.selection === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => tap(opt.value)}
              disabled={saving}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-medium transition',
                selected
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/40'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
