'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { fetchProgramDetail, fetchProgramSettings } from '@/features/programs/programsApi';

import { CardHeader } from './CardHeader';

type AttackStatus = {
  signal: 'hit' | 'miss' | 'na' | null;
  onsetToDoseMinutes: number | null;
};

type State = {
  windowMinutes: number;
  treatedEarly: number;
  evaluated: number;
  latestMinutes: number | null;
};

async function fetchRecentAttackIds(limit: number): Promise<string[]> {
  const res = await fetch(`/api/episodes/recent?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) {
    return [];
  }
  const data = await res.json().catch(() => ({ episodes: [] }));
  return ((data?.episodes ?? []) as Array<{ id: string | number }>).map(e => String(e.id));
}

async function fetchAttackTiming(id: string): Promise<AttackStatus | null> {
  const res = await fetch(`/api/programs/acute-med-timing/attack/${id}`, { cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  return res.json().catch(() => null);
}

export function AcuteMedTimingCard({ refreshToken }: { refreshToken?: number }) {
  const t = useTranslations('DashboardHome');
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await fetchProgramSettings().catch(() => null);
      if (cancelled || !settings?.enabled) {
        return;
      }
      const detail = await fetchProgramDetail('acute-med-timing').catch(() => null);
      if (cancelled || !detail?.activeEnrollment) {
        return;
      }
      const windowMinutes = (detail.activeEnrollment.targetPayload as { acuteWindowMinutes: number }).acuteWindowMinutes;

      const ids = await fetchRecentAttackIds(5);
      if (cancelled) {
        return;
      }
      const statuses = await Promise.all(ids.map(fetchAttackTiming));
      if (cancelled) {
        return;
      }
      let treatedEarly = 0;
      let evaluated = 0;
      let latestMinutes: number | null = null;
      statuses.forEach((s, i) => {
        if (!s) {
          return;
        }
        if (s.signal === 'hit' || s.signal === 'miss') {
          evaluated++;
          if (s.signal === 'hit') {
            treatedEarly++;
          }
        }
        if (i === 0 && s.onsetToDoseMinutes != null) {
          latestMinutes = s.onsetToDoseMinutes;
        }
      });
      setState({ windowMinutes, treatedEarly, evaluated, latestMinutes });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (!state) {
    return null;
  }

  const { windowMinutes, treatedEarly, evaluated, latestMinutes } = state;
  const hasData = evaluated > 0;
  const headlineTitle = hasData
    ? t('acute_treated_early', { treated: treatedEarly, evaluated })
    : t('acute_no_recent');
  const headlineSub = hasData
    ? null
    : t('acute_helper_logs_auto');

  const minutesIntoAttack = latestMinutes ?? 0;
  const onTarget = latestMinutes != null && latestMinutes < windowMinutes;
  const past = latestMinutes != null && latestMinutes >= windowMinutes;
  const pct = Math.min(100, (minutesIntoAttack / windowMinutes) * 100);

  return (
    <section className="mc-card">
      <CardHeader
        eyebrow={t('acute_eyebrow')}
        title={headlineTitle}
        sub={headlineSub ?? undefined}
        action={{ label: t('acute_action'), href: '/dashboard/programs/acute-med-timing/progress' }}
      />

      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: onTarget ? 'var(--mc-good-fg)' : past ? 'var(--mc-warn-fg)' : 'var(--mc-fg-muted)' }}
        >
          {t('acute_target_label', { minutes: windowMinutes })}
        </span>
        <span className="mc-tnum text-[11px] font-semibold" style={{ color: 'var(--mc-fg-2)' }}>
          {latestMinutes == null
            ? '—'
            : onTarget
              ? t('timeline_minutes_left', { minutes: windowMinutes - minutesIntoAttack })
              : t('timeline_minutes_past', { minutes: minutesIntoAttack - windowMinutes })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--mc-bg-subtle)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: onTarget
              ? 'linear-gradient(90deg, var(--mc-good-fg), #34d399)'
              : past
                ? 'linear-gradient(90deg, var(--mc-warn-fg), #f59e0b)'
                : 'var(--mc-border-strong)',
          }}
        />
      </div>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--mc-fg-muted)' }}>
        {t('acute_helper_no_daily')}
      </p>
    </section>
  );
}
