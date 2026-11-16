'use client';

import type { PreventiveDueResponse, PreventivePlanSummary } from '@/features/preventives/preventivesApi';
import { Check, Pill } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import {
  fetchPreventiveDue,
  fetchPreventiveSummary,
  upsertPreventiveIntake,
} from '@/features/preventives/preventivesApi';
import { showSnackbar } from '@/features/snackbar';

import { CardHeader } from './CardHeader';

type Row = {
  id: string;
  name: string;
  dose: string | null;
  scheduleLabel: string;
  state: 'taken' | 'missed' | 'unsure' | null;
  history: boolean[];
};

const HISTORY_LEN = 7;

export function PreventivesCard({ refreshToken, onDidLog }: { refreshToken?: number; onDidLog?: () => void }) {
  const t = useTranslations('DashboardHome');
  const [data, setData] = useState<PreventiveDueResponse | null>(null);
  const [adherence, setAdherence] = useState<Record<string, boolean[]>>({});
  const [loggingId, setLoggingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPreventiveDue()
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        setData(res);
        // Hydrate adherence pips per plan in parallel (small N).
        const summaries = await Promise.all(
          res.due.map(p => fetchPreventiveSummary(p.id).catch(() => null)),
        );
        if (cancelled) {
          return;
        }
        const map: Record<string, boolean[]> = {};
        summaries.forEach((s, i) => {
          const id = res.due[i]?.id;
          if (!id || !s) {
            return;
          }
          map[id] = historyFromSummary(s);
        });
        setAdherence(map);
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

  async function logTaken(p: Row) {
    if (!data || loggingId) {
      return;
    }
    setLoggingId(p.id);
    try {
      await upsertPreventiveIntake({
        planId: p.id,
        localDate: data.todayLocalDate,
        state: 'taken',
      });
      setData((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          due: prev.due.map(d => (d.id === p.id ? { ...d, state: 'taken' } : d)),
        };
      });
      showSnackbar({ message: t('preventives_log_snackbar', { name: p.name }) });
      onDidLog?.();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('preventives_failed_log') });
    } finally {
      setLoggingId(null);
    }
  }

  if (!data || !data.hasActivePlans || data.due.length === 0) {
    return null;
  }

  const rows: Row[] = data.due.map(p => ({
    id: p.id,
    name: stripDose(p.name).name,
    dose: stripDose(p.name).dose,
    scheduleLabel: p.scheduleLabel,
    state: p.state,
    history: adherence[p.id] ?? Array.from<boolean>({ length: HISTORY_LEN }).fill(false),
  }));

  return (
    <section className="mc-card">
      <CardHeader
        eyebrow={t('preventives_due_eyebrow')}
        title={t('preventives_due_title')}
        action={{ label: t('preventives_manage'), href: '/dashboard/settings/treatments' }}
      />
      <ul className="divide-y" style={{ borderColor: 'var(--mc-border)' }}>
        {rows.map(r => (
          <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--mc-med-bg)', color: 'var(--mc-med-fg)' }}
            >
              <Pill className="size-[18px]" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold leading-tight" style={{ color: 'var(--mc-fg)' }}>
                {r.name}
                {r.dose && (
                  <span className="font-medium" style={{ color: 'var(--mc-fg-muted)' }}>
                    {' '}
                    ·
                    {r.dose}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
                  {r.scheduleLabel}
                </span>
                <span className="flex gap-0.5">
                  {r.history.slice(0, HISTORY_LEN).map((h, i) => (
                    <span
                      key={`${r.id}-pip-${i}`}
                      className="size-1.5 rounded-full"
                      style={{ background: h ? 'var(--mc-good-fg)' : 'var(--mc-border-strong)' }}
                      title={h ? t('preventives_taken') : t('preventives_missed_unrecorded')}
                    />
                  ))}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => logTaken(r)}
              disabled={r.state === 'taken' || loggingId === r.id}
              className="mc-ring rounded-full text-[13px] font-semibold transition-colors"
              style={{
                padding: '8px 14px',
                background: r.state === 'taken' ? 'var(--mc-good-bg)' : 'var(--mc-surface)',
                color: r.state === 'taken' ? 'var(--mc-good-fg)' : 'var(--mc-fg)',
                border: `1px solid ${r.state === 'taken' ? 'transparent' : 'var(--mc-border)'}`,
                cursor: r.state === 'taken' ? 'default' : 'pointer',
              }}
            >
              {r.state === 'taken'
                ? (
                    <span className="flex items-center gap-1.5">
                      <Check className="size-3.5" strokeWidth={2.2} />
                      {t('preventives_logged')}
                    </span>
                  )
                : t('preventives_log')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function stripDose(name: string): { name: string; dose: string | null } {
  // Split on bullet/middle-dot if present; otherwise on whitespace before a digit run.
  const sepIdx = name.search(/\s*·\s*/);
  if (sepIdx > 0) {
    const head = name.slice(0, sepIdx).trim();
    const tail = name.slice(sepIdx).replace(/^\s*·\s*/, '').trim();
    if (tail) {
      return { name: head, dose: tail };
    }
  }
  const m = /\s(\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|iu|%))$/i.exec(name);
  if (m) {
    return { name: name.slice(0, m.index).trim(), dose: m[1]!.trim() };
  }
  return { name, dose: null };
}

function historyFromSummary(s: PreventivePlanSummary): boolean[] {
  // last7.dueDays may be < 7 if plan started recently; build from `taken` count
  // as a coarse signal (true for taken count from oldest).
  const week = s.adherence?.last7;
  if (!week) {
    return Array.from<boolean>({ length: HISTORY_LEN }).fill(false);
  }
  const out = Array.from<boolean>({ length: HISTORY_LEN }).fill(false);
  const taken = Math.min(HISTORY_LEN, week.taken);
  for (let i = HISTORY_LEN - taken; i < HISTORY_LEN; i++) {
    out[i] = true;
  }
  return out;
}
