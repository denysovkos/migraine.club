'use client';

import type { Episode } from '@/types/Episode';
import { ArrowRight, Bed, NotebookPen, Pill, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useMemo, useState } from 'react';
import { fetchDiaryDayDetail } from '@/features/diary/diaryApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { PreventiveIntakeState } from '@/types/Preventives';

type EventKind = 'sleep' | 'med' | 'attack' | 'note';

type TimelineEvent = {
  id: string;
  time: string;
  sortKey: number;
  kind: EventKind;
  title: string;
  sub?: string;
};

const KIND_STYLE: Record<EventKind, { bg: string; fg: string; Icon: typeof Bed }> = {
  sleep: { bg: 'var(--mc-info-bg)', fg: 'var(--mc-info-fg)', Icon: Bed },
  med: { bg: 'var(--mc-med-bg)', fg: 'var(--mc-med-fg)', Icon: Pill },
  attack: { bg: 'var(--mc-attack-bg)', fg: 'var(--mc-attack-fg)', Icon: Sparkles },
  note: { bg: 'var(--mc-brand-soft)', fg: 'var(--mc-brand-press)', Icon: NotebookPen },
};

function formatHHmm(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function sleepDurationLabel(bed: string | null, wake: string | null): string | null {
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

/** Today's sleep-regularity chip selection, or null when there is none. */
async function fetchSleepProgramToday(): Promise<{ bedTime: string | null; wakeTime: string | null } | null> {
  try {
    const res = await fetch('/api/programs/sleep-regularity/today-status', { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!data?.signal || !data?.payload) {
      return null;
    }
    return { bedTime: data.payload.bedTime ?? null, wakeTime: data.payload.wakeTime ?? null };
  } catch {
    return null;
  }
}

export function TodayTimeline({
  ongoing,
  loadingOngoing,
  refreshToken,
  onDidLog,
}: {
  ongoing: Episode | null;
  loadingOngoing: boolean;
  refreshToken?: number;
  onDidLog?: () => void;
}) {
  const t = useTranslations('DashboardHome');
  const router = useRouter();
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [takeOpen, setTakeOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = DateTime.local().toISODate();
      if (!today) {
        return;
      }
      try {
        const [res, sleepProgram] = await Promise.all([
          fetchDiaryDayDetail({ date: today }),
          // The dashboard sleep chip writes to program_adherence_event, not to
          // the diary entry, so a tapped "On target" is invisible to the day
          // detail. 404 here just means the module is off or not enrolled.
          fetchSleepProgramToday(),
        ]);
        if (cancelled) {
          return;
        }
        const list: TimelineEvent[] = [];

        const diarySleep = {
          bed: res.entry?.bedTimeLocal ?? null,
          wake: res.entry?.wakeTimeLocal ?? null,
        };
        // The diary stays the source of truth; the chip only fills the gap.
        const sleep = diarySleep.wake
          ? diarySleep
          : { bed: sleepProgram?.bedTime ?? null, wake: sleepProgram?.wakeTime ?? null };
        const sleepDur = sleepDurationLabel(sleep.bed, sleep.wake);
        if (sleepDur && sleep.wake) {
          const [wh, wm] = sleep.wake.split(':').map(Number);
          list.push({
            id: 'sleep',
            time: sleep.wake.slice(0, 5),
            sortKey: (wh ?? 0) * 60 + (wm ?? 0),
            kind: 'sleep',
            title: t('timeline_slept', { duration: sleepDur }),
            sub: sleep.bed ? t('timeline_woke_up_at', { time: sleep.wake.slice(0, 5) }) : undefined,
          });
        }

        for (const p of res.preventiveIntakes ?? []) {
          if (p.state !== PreventiveIntakeState.TAKEN || !p.takenAt) {
            continue;
          }
          const d = new Date(p.takenAt);
          list.push({
            id: `preventive-${p.id}`,
            time: formatHHmm(d),
            sortKey: d.getHours() * 60 + d.getMinutes(),
            kind: 'med',
            title: p.doseText ? `${p.label} ${p.doseText}` : p.label,
            sub: t('timeline_logged'),
          });
        }

        for (const m of res.medicationIntakes) {
          const d = new Date(m.takenAt);
          const doseSuffix = [m.dose, m.unit].filter(Boolean).join(' ');
          list.push({
            id: `med-${m.id}`,
            time: formatHHmm(d),
            sortKey: d.getHours() * 60 + d.getMinutes(),
            kind: 'med',
            title: doseSuffix ? `${m.label} ${doseSuffix}` : m.label,
            sub: t('timeline_logged'),
          });
        }

        for (const a of res.attacks) {
          const d = new Date(a.startTime);
          list.push({
            id: `attack-${a.id}`,
            time: formatHHmm(d),
            sortKey: d.getHours() * 60 + d.getMinutes(),
            kind: 'attack',
            title: a.isOngoing ? t('timeline_attack_started') : t('timeline_attack'),
            sub: a.isOngoing
              ? t('timeline_onset_running', { time: formatHHmm(d), minutes: minutesBetween(d, new Date()) })
              : (a.attackType === 'migraine' ? t('timeline_attack_migraine') : t('timeline_attack_headache')),
          });
        }

        list.sort((a, b) => a.sortKey - b.sortKey);
        setEvents(list);
      } catch {
        if (!cancelled) {
          setEvents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const ongoingStart = ongoing ? new Date((ongoing as any).startTime) : null;
  const minutesSinceOnset = ongoingStart ? minutesBetween(ongoingStart, now) : 0;
  const target = 30;
  const remaining = Math.max(0, target - minutesSinceOnset);
  const onTarget = remaining > 0;
  const pct = Math.min(100, (minutesSinceOnset / target) * 100);
  const inProgress = !!ongoing;

  const eyebrow = inProgress ? t('timeline_eyebrow_attack') : t('timeline_eyebrow');
  const titleText = inProgress ? t('timeline_title_attack') : t('timeline_title_default');
  const subText = inProgress
    ? t('timeline_sub_attack')
    : t('timeline_sub_default');

  const nowLabel = useMemo(() => formatHHmm(now), [now]);

  async function endAttack() {
    if (!ongoing) {
      return;
    }
    setEnding(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${ongoing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endNow: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('timeline_failed_end'));
      }
      onDidLog?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? t('timeline_failed_end'));
    } finally {
      setEnding(false);
    }
  }

  return (
    <section className={`mc-card${inProgress ? ' mc-card--attack' : ''}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: inProgress ? 'var(--mc-attack-fg)' : 'var(--mc-fg-muted)' }}
          >
            {eyebrow}
          </div>
          <h3 className="text-[16px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {titleText}
          </h3>
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            {subText}
          </p>
        </div>
        <Link
          href="/dashboard/diary"
          className="mc-ring mt-0.5 flex shrink-0 items-center gap-1 text-[13px] font-semibold"
          style={{ color: 'var(--mc-brand-press)' }}
        >
          {t('timeline_full_diary')}
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </Link>
      </div>

      {!events && (
        <div className="space-y-3">
          {[0, 1, 2].map(k => (
            <div key={k} className="flex gap-3">
              <div className="size-6 shrink-0 rounded-full" style={{ background: 'var(--mc-bg-subtle)' }} />
              <div className="h-10 flex-1 rounded-lg" style={{ background: 'var(--mc-bg-subtle)' }} />
            </div>
          ))}
        </div>
      )}

      {events && (
        <ul className="mc-tl-rail ml-1 space-y-3 pl-0">
          {events.map((e) => {
            const style = KIND_STYLE[e.kind];
            const isAttackOnset = e.kind === 'attack';
            return (
              <li key={e.id} className="relative pl-9">
                <span
                  className="absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full"
                  style={{
                    background: style.bg,
                    color: style.fg,
                    boxShadow: isAttackOnset
                      ? '0 0 0 3px var(--mc-surface), 0 0 0 5px var(--mc-attack-border)'
                      : '0 0 0 3px var(--mc-surface)',
                  }}
                >
                  <style.Icon className="size-3.5" strokeWidth={2} />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--mc-fg)' }}>
                    {e.title}
                  </div>
                  <div className="mc-tnum shrink-0 text-[11px]" style={{ color: 'var(--mc-fg-muted)' }}>
                    {e.time}
                  </div>
                </div>
                {e.sub && (
                  <div
                    className="mt-0.5 text-[12px]"
                    style={{ color: isAttackOnset ? 'var(--mc-attack-fg)' : 'var(--mc-fg-muted)' }}
                  >
                    {e.sub}
                  </div>
                )}
              </li>
            );
          })}

          <li className="relative pl-9">
            {inProgress
              ? (
                  <>
                    <span
                      className="mc-pulse absolute left-0 top-1 flex size-6 items-center justify-center rounded-full"
                      style={{
                        background: 'var(--mc-attack-strong)',
                        color: '#ffffff',
                        boxShadow: '0 0 0 3px var(--mc-surface), 0 0 0 5px var(--mc-attack-border)',
                      }}
                    >
                      <span className="size-2 rounded-full bg-white" />
                    </span>
                    <div
                      className="rounded-2xl p-3.5"
                      style={{ background: 'var(--mc-attack-bg)', border: '1px solid var(--mc-attack-border)' }}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-attack-fg)' }}>
                          {t('timeline_in_progress')}
                        </div>
                        <div className="mc-tnum text-[12px] font-semibold" style={{ color: 'var(--mc-attack-fg)' }}>
                          {nowLabel}
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="mc-tnum text-[26px] font-bold leading-none" style={{ color: 'var(--mc-fg)' }}>
                          {Math.floor(minutesSinceOnset / 60)}
                          h
                          {' '}
                          {String(minutesSinceOnset % 60).padStart(2, '0')}
                          m
                        </span>
                        <span className="text-[12.5px]" style={{ color: 'var(--mc-fg-2)' }}>{t('timeline_since_onset')}</span>
                      </div>

                      <div className="mt-3">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-attack-fg)' }}>
                            {t('timeline_treat_early_window', { minutes: target })}
                          </span>
                          <span className="mc-tnum text-[11px] font-semibold" style={{ color: 'var(--mc-attack-fg)' }}>
                            {onTarget
                              ? t('timeline_minutes_left', { minutes: remaining })
                              : t('timeline_minutes_past', { minutes: minutesSinceOnset - target })}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(123,107,146,0.18)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              background: onTarget ? '#9d8fb8' : '#8b9d8a',
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setTakeOpen(true)}
                          className="mc-ring flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold"
                          style={{ background: 'var(--mc-attack-strong)', color: '#ffffff' }}
                        >
                          <Pill className="size-3.5" strokeWidth={2.2} />
                          {t('timeline_log_acute_med')}
                        </button>
                        <Link
                          href={`/dashboard/episodes/${ongoing.id}`}
                          className="mc-ring rounded-full px-3.5 py-2 text-[13px] font-semibold"
                          style={{
                            background: 'var(--mc-surface)',
                            color: 'var(--mc-fg)',
                            border: '1px solid var(--mc-attack-border)',
                          }}
                        >
                          {t('timeline_edit_details')}
                        </Link>
                        <button
                          type="button"
                          onClick={endAttack}
                          disabled={ending}
                          className="mc-ring rounded-full px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
                          style={{
                            background: 'transparent',
                            color: 'var(--mc-attack-fg)',
                            border: '1px solid var(--mc-attack-border)',
                          }}
                        >
                          {ending ? t('timeline_ending') : t('timeline_end_attack')}
                        </button>
                      </div>

                      {error && (
                        <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--mc-bad-bg)', color: 'var(--mc-bad-fg)' }}>
                          {error}
                        </div>
                      )}
                    </div>
                  </>
                )
              : (
                  <>
                    <span
                      className="mc-pulse absolute left-0 top-1 flex size-6 items-center justify-center rounded-full"
                      style={{
                        background: 'var(--mc-brand)',
                        color: '#ffffff',
                        boxShadow: '0 0 0 3px var(--mc-surface), 0 0 0 5px rgba(99,102,241,0.18)',
                      }}
                    >
                      <span className="size-2 rounded-full bg-white" />
                    </span>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-brand-press)' }}>
                        {t('timeline_now')}
                      </div>
                      <div className="mc-tnum text-[11px]" style={{ color: 'var(--mc-brand-press)' }}>
                        {nowLabel}
                      </div>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <div className="text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
                        {loadingOngoing
                          ? t('timeline_loading_today')
                          : (events.length === 0
                              ? t('timeline_empty_no_logs')
                              : t('timeline_empty_no_attack'))}
                      </div>
                    </div>
                  </>
                )}
          </li>
        </ul>
      )}

      {ongoing && (
        <TakeMedicationSheet
          open={takeOpen}
          onOpenChange={setTakeOpen}
          episodeId={ongoing.id as any}
          onDidLog={() => {
            onDidLog?.();
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
