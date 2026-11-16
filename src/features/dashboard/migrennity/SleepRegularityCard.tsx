'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { fetchTodayDiary } from '@/features/diary/diaryApi';
import { fetchProgramDetail, fetchProgramSettings, logSleepAdherence } from '@/features/programs/programsApi';
import { showSnackbar } from '@/features/snackbar';

type Selection = 'on_target' | 'off_track' | 'skip' | null;

type State = {
  target: { bedTime: string; wakeTime: string };
  today: string;
  selection: Selection;
  durationLabel: string | null;
  durationOnTarget: boolean | null;
};

function signalToSelection(
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
  if (payload && payload.bedTime === null && payload.wakeTime === null) {
    return 'skip';
  }
  return null;
}

function computeDuration(bed: string | null, wake: string | null): string | null {
  if (!bed || !wake) {
    return null;
  }
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  if ([bh, bm, wh, wm].some(n => Number.isNaN(n))) {
    return null;
  }
  let mins = (wh! * 60 + wm!) - (bh! * 60 + bm!);
  if (mins < 0) {
    mins += 24 * 60;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function SleepRegularityCard({ onDidLog }: { onDidLog?: () => void } = {}) {
  const t = useTranslations('DashboardHome');
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
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
      const todayStatusRes = await fetch('/api/programs/sleep-regularity/today-status', { cache: 'no-store' }).catch(() => null);
      const todayStatus = todayStatusRes && todayStatusRes.ok ? await todayStatusRes.json().catch(() => null) : null;
      if (cancelled) {
        return;
      }
      const selection = signalToSelection(todayStatus?.signal ?? null, todayStatus?.payload ?? null);
      const bed = today.entry?.bedTimeLocal ?? null;
      const wake = today.entry?.wakeTimeLocal ?? null;
      const durationLabel = computeDuration(bed, wake);
      setState({
        target,
        today: today.todayLocalDate,
        selection,
        durationLabel,
        durationOnTarget: selection === 'on_target' ? true : (selection === 'off_track' ? false : null),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return null;
  }

  async function tap(value: 'on_target' | 'off_track' | 'skip') {
    if (!state || saving) {
      return;
    }
    if (value === 'off_track') {
      router.push(`/dashboard/diary?date=${state.today}`);
      return;
    }
    const body
      = value === 'on_target'
        ? { bedTimeLocal: state.target.bedTime, wakeTimeLocal: state.target.wakeTime }
        : { bedTimeLocal: null, wakeTimeLocal: null };
    const optimistic: State = {
      ...state,
      selection: value,
      durationLabel: value === 'on_target' ? computeDuration(state.target.bedTime, state.target.wakeTime) : state.durationLabel,
      durationOnTarget: value === 'on_target' ? true : (value === 'skip' ? null : state.durationOnTarget),
    };
    setState(optimistic);
    try {
      setSaving(true);
      await logSleepAdherence({ localDate: state.today, ...body });
      showSnackbar({ message: t('sleep_saved') });
      onDidLog?.();
    } catch {
      showSnackbar({ message: t('sleep_failed_save') });
      setState(state);
    } finally {
      setSaving(false);
    }
  }

  const showDuration = !!state.durationLabel;
  const pillBg = state.durationOnTarget === true
    ? { bg: 'var(--mc-good-bg)', fg: 'var(--mc-good-fg)' }
    : state.durationOnTarget === false
      ? { bg: 'var(--mc-warn-bg)', fg: 'var(--mc-warn-fg)' }
      : { bg: 'var(--mc-bg-subtle)', fg: 'var(--mc-fg-muted)' };
  const pillLabel = state.durationOnTarget === true
    ? t('sleep_on_target')
    : state.durationOnTarget === false
      ? t('sleep_off_track')
      : t('sleep_pending');

  const options: { value: 'on_target' | 'off_track' | 'skip'; label: string }[] = [
    { value: 'on_target', label: t('sleep_on_target') },
    { value: 'off_track', label: t('sleep_off_track') },
    { value: 'skip', label: t('sleep_skip') },
  ];

  return (
    <section className="mc-card">
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
          {t('sleep_eyebrow', { bed: state.target.bedTime, wake: state.target.wakeTime })}
        </div>
        <h3 className="mt-0.5 text-[16px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
          {t('sleep_title')}
        </h3>
      </div>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        {showDuration
          ? (
              <span className="mc-tnum text-[28px] font-bold leading-none" style={{ color: 'var(--mc-fg)' }}>
                {state.durationLabel}
              </span>
            )
          : (
              <span className="text-[15px] font-medium" style={{ color: 'var(--mc-fg-muted)' }}>
                {t('sleep_no_logged')}
              </span>
            )}
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ background: pillBg.bg, color: pillBg.fg }}
        >
          {pillLabel}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" aria-busy={saving}>
        {options.map((opt) => {
          const selected = state.selection === opt.value;
          const isOn = opt.value === 'on_target';
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => tap(opt.value)}
              disabled={saving}
              className="mc-ring rounded-xl py-2 text-[12.5px] font-semibold transition-colors"
              style={{
                background: selected
                  ? (isOn ? 'var(--mc-good-bg)' : 'var(--mc-bg-subtle)')
                  : 'var(--mc-surface)',
                color: selected
                  ? (isOn ? 'var(--mc-good-fg)' : 'var(--mc-fg)')
                  : 'var(--mc-fg-2)',
                border: `1px solid ${selected ? 'transparent' : 'var(--mc-border)'}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
