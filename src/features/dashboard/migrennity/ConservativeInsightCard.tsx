'use client';

import { Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { fetchDiaryRange } from '@/features/diary/diaryApi';

type State = {
  thisCount: number;
  priorCount: number;
  thisCoveragePct: number;
  priorCoveragePct: number;
};

const SUFFICIENCY = 0.6;

function countMigraineDays(entries: ReadonlyArray<{ dayType: string } | null>) {
  let n = 0;
  for (const e of entries) {
    if (e && e.dayType === 'migraine_day') {
      n++;
    }
  }
  return n;
}

export function ConservativeInsightCard({ refreshToken }: { refreshToken?: number }) {
  const t = useTranslations('DashboardHome');
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = DateTime.local().startOf('day');
      const thisFrom = today.minus({ days: 29 }).toISODate();
      const thisTo = today.toISODate();
      const priorFrom = today.minus({ days: 59 }).toISODate();
      const priorTo = today.minus({ days: 30 }).toISODate();
      if (!thisFrom || !thisTo || !priorFrom || !priorTo) {
        return;
      }
      try {
        const [thisRes, priorRes] = await Promise.all([
          fetchDiaryRange({ from: thisFrom, to: thisTo }),
          fetchDiaryRange({ from: priorFrom, to: priorTo }),
        ]);
        if (cancelled) {
          return;
        }
        setState({
          thisCount: countMigraineDays(thisRes.entries),
          priorCount: countMigraineDays(priorRes.entries),
          thisCoveragePct: thisRes.coverage.totalDays
            ? thisRes.coverage.recordedDays / thisRes.coverage.totalDays
            : 0,
          priorCoveragePct: priorRes.coverage.totalDays
            ? priorRes.coverage.recordedDays / priorRes.coverage.totalDays
            : 0,
        });
      } catch {
        if (!cancelled) {
          setState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (!state) {
    return null;
  }

  const sufficient = state.thisCoveragePct >= SUFFICIENCY && state.priorCoveragePct >= SUFFICIENCY;
  if (!sufficient) {
    return null;
  }

  const delta = state.thisCount - state.priorCount;
  let title: string;
  if (delta < 0) {
    title = t('conservative_lower');
  } else if (delta > 0) {
    title = t('conservative_higher');
  } else {
    title = t('conservative_steady');
  }

  return (
    <section
      className="mc-card relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, var(--mc-brand-soft), var(--mc-surface) 60%)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--mc-brand)', color: 'var(--mc-brand-fg)' }}
        >
          <Sparkles className="size-[18px]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-brand-press)' }}>
            {t('conservative_eyebrow')}
          </div>
          <h3 className="mt-0.5 text-[16px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {title}
          </h3>
          <p className="mt-1.5 text-[13px]" style={{ color: 'var(--mc-fg-2)' }}>
            {t('conservative_summary', { thisCount: state.thisCount, priorCount: state.priorCount })}
            <span style={{ color: 'var(--mc-fg-muted)' }}>
              {' '}
              {t('conservative_caveat')}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
