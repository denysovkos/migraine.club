'use client';

import { Brain, Check, Circle, CircleAlert, CircleDot } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { fetchDiaryRange } from '@/features/diary/diaryApi';

type CellState = 'free' | 'headache' | 'migraine' | 'missing';

type Day = {
  date: string;
  dow: string;
  state: CellState;
  hasAttack: boolean;
  isToday: boolean;
  label: string;
};

function dayTypeToState(dayType: 'headache_free' | 'headache_day' | 'migraine_day' | null | undefined): CellState {
  if (dayType === 'headache_free') {
    return 'free';
  }
  if (dayType === 'headache_day') {
    return 'headache';
  }
  if (dayType === 'migraine_day') {
    return 'migraine';
  }
  return 'missing';
}

function StateIcon({ state }: { state: CellState }) {
  if (state === 'migraine') {
    return <Brain className="size-3.5" style={{ color: '#f43f5e' }} aria-hidden />;
  }
  if (state === 'headache') {
    return <CircleAlert className="size-3.5" style={{ color: '#f59e0b' }} aria-hidden />;
  }
  if (state === 'free') {
    return <Check className="size-3.5" style={{ color: '#10b981' }} aria-hidden />;
  }
  return <Circle className="size-3.5" style={{ color: 'var(--mc-fg-faint)' }} aria-hidden />;
}

function stateLabel(state: CellState, t: ReturnType<typeof useTranslations<'DashboardHome'>>) {
  if (state === 'free') {
    return t('streak_state_free');
  }
  if (state === 'headache') {
    return t('streak_state_headache');
  }
  if (state === 'migraine') {
    return t('streak_state_migraine');
  }
  return t('streak_state_missing');
}

export function StreakStrip({
  refreshToken,
  onStreakChange,
  showStreakLabel = false,
}: {
  refreshToken?: number;
  onStreakChange?: (n: number) => void;
  showStreakLabel?: boolean;
}) {
  const t = useTranslations('DashboardHome');
  const [days, setDays] = useState<Day[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = DateTime.local().startOf('day');
      const from = today.minus({ days: 13 }).toISODate();
      const to = today.toISODate();
      if (!from || !to) {
        return;
      }
      try {
        const res = await fetchDiaryRange({ from, to });
        if (cancelled) {
          return;
        }
        const byDate = new Map<string, CellState>();
        for (const entry of res.entries) {
          if (entry) {
            byDate.set(entry.localDate, dayTypeToState(entry.dayType));
          }
        }
        const attackSet = new Set(res.attackDays);
        const out: Day[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = today.minus({ days: i });
          const iso = d.toISODate()!;
          const state: CellState = byDate.get(iso) ?? 'missing';
          const isToday = i === 0;
          const hasAttack = attackSet.has(iso);
          out.push({
            date: iso,
            dow: d.toFormat('ccccc'),
            state,
            hasAttack,
            isToday,
            label: `${d.toFormat('LLL d')}${isToday ? ` — ${t('streak_label_today_suffix')}` : ''} · ${stateLabel(state, t)}${hasAttack ? ` · ${t('streak_label_attack')}` : ''}`,
          });
        }
        setDays(out);
      } catch {
        if (!cancelled) {
          setDays([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const headacheFree = useMemo(() => {
    if (!days) {
      return null;
    }
    let n = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const day = days[i]!;
      if (day.state === 'free' || (day.isToday && day.state === 'missing' && !day.hasAttack)) {
        n++;
      } else {
        break;
      }
    }
    return n;
  }, [days]);

  useEffect(() => {
    if (headacheFree != null && onStreakChange) {
      onStreakChange(headacheFree);
    }
  }, [headacheFree, onStreakChange]);

  if (!days) {
    return (
      <div className="mc-streak-grid grid gap-1.5">
        {Array.from({ length: 14 }, (_, i) => `skeleton-${i}`).map(key => (
          <div key={key} className="mc-streak-day">
            <div className="mc-streak-cell opacity-50" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mc-streak-grid grid gap-1.5">
        {days.map(d => (
          <div key={d.date} className="mc-streak-day flex flex-col items-center gap-1">
            <div
              className="mc-streak-cell w-full"
              data-state={d.state}
              data-today={d.isToday ? 'true' : undefined}
              title={d.label}
              aria-label={d.label}
            >
              <span
                className="mc-tnum text-[10px] font-semibold leading-none"
                style={{ color: d.isToday ? 'var(--mc-brand-press)' : 'var(--mc-fg-muted)' }}
              >
                {d.date.slice(-2).replace(/^0/, '')}
              </span>
              <StateIcon state={d.state} />
              {d.hasAttack && (
                <CircleDot className="size-3" style={{ color: '#38bdf8' }} aria-hidden />
              )}
            </div>
            <span
              className="text-[9px] font-medium uppercase"
              style={{ color: d.isToday ? 'var(--mc-brand-press)' : 'var(--mc-fg-faint)' }}
            >
              {d.dow}
            </span>
          </div>
        ))}
      </div>
      {showStreakLabel && headacheFree !== null && (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="mc-tnum text-[28px] font-bold leading-none" style={{ color: 'var(--mc-fg)' }}>
            {headacheFree}
          </span>
          <span className="text-[14px] font-medium" style={{ color: 'var(--mc-fg-2)' }}>
            {t('days_headache_free_suffix', { days: headacheFree })}
          </span>
        </div>
      )}
    </div>
  );
}
