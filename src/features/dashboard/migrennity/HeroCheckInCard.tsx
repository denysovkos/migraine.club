'use client';

import type { DiaryTodayResponse } from '@/features/diary/diaryApi';
import { ArrowRight, Brain, Check, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchTodayDiary, upsertDiaryEntry } from '@/features/diary/diaryApi';
import { showSnackbar } from '@/features/snackbar';
import { isEditableLocalDate } from '@/services/localDate';

import { StreakStrip } from './StreakStrip';

type DayType = 'headache_free' | 'headache_day' | 'migraine_day';

function dayPill(dayType: DayType | null, t: ReturnType<typeof useTranslations<'DashboardHome'>>) {
  if (dayType === 'headache_free') {
    return {
      bg: 'var(--mc-good-bg)',
      fg: 'var(--mc-good-fg)',
      Icon: Check,
      label: t('pill_no_pain'),
    };
  }
  if (dayType === 'headache_day') {
    return {
      bg: 'var(--mc-warn-bg)',
      fg: 'var(--mc-warn-fg)',
      Icon: CircleAlert,
      label: t('pill_headache_day'),
    };
  }
  if (dayType === 'migraine_day') {
    return {
      bg: 'var(--mc-bad-bg)',
      fg: 'var(--mc-bad-fg)',
      Icon: Brain,
      label: t('pill_migraine_day'),
    };
  }
  return null;
}

export function HeroCheckInCard({
  refreshToken,
  hasOngoingAttack,
  ongoingAttackType,
  onDidLog,
}: {
  refreshToken?: number;
  hasOngoingAttack: boolean;
  ongoingAttackType: 'migraine' | 'headache' | null;
  onDidLog?: () => void;
}) {
  const tDiary = useTranslations('Diary');
  const t = useTranslations('DashboardHome');
  const OPTIONS: { id: DayType; label: string }[] = [
    { id: 'headache_free', label: t('seg_no_pain') },
    { id: 'headache_day', label: t('seg_headache') },
    { id: 'migraine_day', label: t('seg_migraine') },
  ];
  const [data, setData] = useState<DiaryTodayResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [streakDays, setStreakDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTodayDiary()
      .then((res) => {
        if (!cancelled) {
          setData(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const selection: DayType | null = data?.entry?.dayType ?? null;

  const editable = useMemo(() => {
    if (!data) {
      return false;
    }
    return isEditableLocalDate(data.todayLocalDate as any, new Date(), data.timezone);
  }, [data]);

  const minAllowedLevel = useMemo(() => {
    if (!hasOngoingAttack) {
      return -1;
    }
    if (ongoingAttackType === 'migraine') {
      return 2;
    }
    if (ongoingAttackType === 'headache') {
      return 1;
    }
    return -1;
  }, [hasOngoingAttack, ongoingAttackType]);

  const levelFor = (v: DayType): number => (v === 'headache_free' ? 0 : v === 'headache_day' ? 1 : 2);

  const handleStreakChange = useCallback((n: number) => setStreakDays(n), []);

  async function tap(value: DayType) {
    if (!data || saving || !editable) {
      return;
    }
    if (levelFor(value) < minAllowedLevel) {
      showSnackbar({ message: t('attack_ongoing_min_level') });
      return;
    }
    setSaving(true);
    try {
      await upsertDiaryEntry({
        localDate: data.todayLocalDate,
        patch: { dayType: value },
      });
      setData(prev => prev
        ? ({
            ...prev,
            entry: {
              ...(prev.entry ?? {
                id: 'tmp',
                userId: '',
                localDate: prev.todayLocalDate,
                timezone: prev.timezone,
                impact: null,
                notes: null,
                bedTimeLocal: null,
                wakeTimeLocal: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdFrom: 'user',
              }),
              dayType: value,
            },
          })
        : prev);
      showSnackbar({ message: t('saved') });
      onDidLog?.();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? tDiary('error_generic') });
    } finally {
      setSaving(false);
    }
  }

  const pill = dayPill(selection, t);

  return (
    <section className="mc-card mc-hero-card" aria-label={t('today_check_in_aria')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
            {t('todays_going')}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="mc-tnum text-[28px] font-bold leading-none md:text-[32px]" style={{ color: 'var(--mc-fg)' }}>
              {streakDays ?? '—'}
            </span>
            <span className="text-[15px] font-medium" style={{ color: 'var(--mc-fg-2)' }}>
              {streakDays != null ? t('days_headache_free_suffix', { days: streakDays }) : null}
            </span>
          </div>
        </div>
        {pill && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ background: pill.bg, color: pill.fg }}
          >
            <pill.Icon className="size-[13px]" strokeWidth={2} />
            {pill.label}
          </span>
        )}
      </div>

      <StreakStrip refreshToken={refreshToken} onStreakChange={handleStreakChange} />

      <div
        className="mt-5 grid grid-cols-3 gap-1 rounded-full p-1"
        style={{ background: 'var(--mc-bg-subtle)' }}
        aria-busy={saving}
      >
        {OPTIONS.map((o) => {
          const on = selection === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => tap(o.id)}
              disabled={saving || !editable}
              className="mc-ring rounded-full py-2 text-[13px] font-semibold transition-colors disabled:opacity-60"
              style={{
                background: on ? 'var(--mc-surface)' : 'transparent',
                color: on ? 'var(--mc-fg)' : 'var(--mc-fg-muted)',
                boxShadow: on ? 'var(--mc-shadow-xs)' : 'none',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <Link
        href="/dashboard/diary"
        className="mc-ring mt-4 flex items-center gap-1 text-[13px] font-semibold"
        style={{ color: 'var(--mc-brand-press)' }}
      >
        {t('open_diary_plain')}
        <ArrowRight className="size-3.5" strokeWidth={2} />
      </Link>
    </section>
  );
}
