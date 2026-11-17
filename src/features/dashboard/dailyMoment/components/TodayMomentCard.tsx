'use client';

import type { DiaryTodayResponse } from '@/features/diary/diaryApi';
import { Activity, Check, HelpCircle, Lock, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { useUserProfileContext } from '@/features/auth/UserProfileProvider';
import { applyQueuedDiaryPatch, fetchDiaryRange, fetchTodayDiary, upsertDiaryEntry } from '@/features/diary/diaryApi';
import { setLastAttackType } from '@/features/episodes/attackTypePrefs';
import { isEditableLocalDate } from '@/services/localDate';
import { cn } from '@/utils/Helpers';

type DayType = 'headache_free' | 'headache_day' | 'migraine_day';

type ViewState
  = | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | {
      kind: 'ready';
      data: DiaryTodayResponse;
      selection: DayType | null;
      isSaving: boolean;
      saveError: string | null;
      savedTick: number;
      showAttackPromptFor: null | 'headache' | 'migraine';
    };

function badgeConfig(args: { entry: DiaryTodayResponse['entry'] }) {
  if (!args.entry) {
    return {
      key: 'missing' as const,
      Icon: HelpCircle,
      className: 'bg-muted text-foreground/80',
    };
  }
  if (args.entry.dayType === 'headache_free') {
    return {
      key: 'no_pain' as const,
      Icon: Check,
      className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
    };
  }
  if (args.entry.dayType === 'headache_day') {
    return {
      key: 'headache' as const,
      Icon: Activity,
      className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    };
  }
  return {
    key: 'migraine' as const,
    Icon: Sparkles,
    className: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  };
}

export function TodayMomentCard(props: {
  refreshToken?: number;
  hasOngoingAttack: boolean;
  ongoingAttackType: 'migraine' | 'headache' | null;
  onDidLog?: () => void;
}) {
  const tDiary = useTranslations('Diary');
  const tHome = useTranslations('DashboardHome');
  const { displayName } = useUserProfileContext();

  const [infoOpen, setInfoOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const [headacheFreeStreakDays, setHeadacheFreeStreakDays] = useState<number | null>(null);
  const [activeTests, setActiveTests] = useState<Array<{ id: string; factorName: string; durationDays: number }>>([]);

  const [state, setState] = useState<ViewState>({ kind: 'loading' });

  useEffect(() => {
    let mounted = true;
    setState({ kind: 'loading' });
    fetchTodayDiary()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setState({
          kind: 'ready',
          data,
          selection: data.entry?.dayType ?? null,
          isSaving: false,
          saveError: null,
          savedTick: 0,
          showAttackPromptFor: null,
        });
      })
      .catch((err) => {
        if (!mounted) {
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : tDiary('error_generic') });
      });
    return () => {
      mounted = false;
    };
  }, [props.refreshToken, tDiary]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/insights/test-plans?status=active', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then((data) => {
        if (!mounted) {
          return;
        }
        const plans = Array.isArray(data?.plans) ? data.plans : [];
        setActiveTests(plans.map((p: any) => ({
          id: p.id,
          factorName: p.factorName ?? 'Factor',
          durationDays: p.durationDays ?? 14,
        })));
      })
      .catch(() => {
        if (mounted) {
          setActiveTests([]);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, []);

  const title = useMemo(() => {
    const name = displayName?.trim();
    if (name && name.length > 0 && name.length <= 18) {
      return tHome('today_title_named', { name });
    }
    return tHome('today_title_generic');
  }, [displayName, tHome]);

  const subtitle = useMemo(() => {
    if (state.kind !== 'ready') {
      return '—';
    }
    const { timezone, todayLocalDate } = state.data;
    return DateTime.fromISO(todayLocalDate, { zone: timezone }).toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    async function computeStreak() {
      if (state.kind !== 'ready') {
        return;
      }
      const entry = state.data.entry;
      if (!entry || entry.dayType !== 'headache_free') {
        setHeadacheFreeStreakDays(null);
        return;
      }
      const { timezone, todayLocalDate } = state.data;
      const to = todayLocalDate;
      const from = DateTime.fromISO(todayLocalDate, { zone: timezone })
        .minus({ days: 59 })
        .toISODate()!;
      try {
        const range = await fetchDiaryRange({ from, to });
        if (cancelled) {
          return;
        }
        const byDate = new Map((range.entries ?? []).filter(Boolean).map(e => [e!.localDate, e!]));
        let streak = 0;
        let cursor = DateTime.fromISO(todayLocalDate, { zone: timezone }).startOf('day');
        for (let i = 0; i < 60; i += 1) {
          const ymd = cursor.toISODate()!;
          const e = byDate.get(ymd) ?? null;
          if (!e || e.dayType !== 'headache_free') {
            break;
          }
          streak += 1;
          cursor = cursor.minus({ days: 1 });
        }
        setHeadacheFreeStreakDays(streak);
      } catch {
        if (!cancelled) {
          setHeadacheFreeStreakDays(null);
        }
      }
    }
    computeStreak();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const editable = useMemo(() => {
    if (state.kind !== 'ready') {
      return false;
    }
    return isEditableLocalDate(state.data.todayLocalDate as any, new Date(), state.data.timezone);
  }, [state]);

  const badge = useMemo(() => (state.kind === 'ready' ? badgeConfig({ entry: state.data.entry }) : null), [state]);
  const badgeLabel = useMemo(() => {
    if (!badge) {
      return null;
    }
    switch (badge.key) {
      case 'missing':
        return tHome('status_missing');
      case 'no_pain':
        return tHome('status_no_pain');
      case 'headache':
        return tHome('status_headache_day');
      case 'migraine':
        return tHome('status_migraine_day');
      default:
        return null;
    }
  }, [badge, tHome]);

  const showSaved = useMemo(() => (state.kind === 'ready' ? state.savedTick > 0 : false), [state]);

  const minAllowedLevel = useMemo(() => {
    // When an attack is ongoing, never allow downgrades below the current attack level.
    if (!props.hasOngoingAttack) {
      return -1;
    }
    if (props.ongoingAttackType === 'migraine') {
      return 2;
    }
    if (props.ongoingAttackType === 'headache') {
      return 1;
    }
    return -1;
  }, [props.hasOngoingAttack, props.ongoingAttackType]);

  const levelFor = (v: DayType | null) => {
    if (!v) {
      return -1;
    }
    if (v === 'headache_free') {
      return 0;
    }
    if (v === 'headache_day') {
      return 1;
    }
    return 2;
  };

  const canSelect = (next: DayType) => {
    if (!props.hasOngoingAttack) {
      return true;
    }
    // Upgrade-only while ongoing.
    return levelFor(next) >= minAllowedLevel;
  };

  const onSelect = async (next: DayType) => {
    if (state.kind !== 'ready') {
      return;
    }
    if (!editable) {
      return;
    }
    if (state.isSaving) {
      return;
    }

    if (!canSelect(next)) {
      setUpgradeOpen(true);
      return;
    }
    if (state.selection === next && state.data.entry?.dayType === next) {
      return;
    }

    const prev = state;
    setState({
      ...prev,
      selection: next,
      isSaving: true,
      saveError: null,
      showAttackPromptFor: null,
    });

    try {
      const saved = (await upsertDiaryEntry({
        localDate: prev.data.todayLocalDate,
        patch: { dayType: next },
      })) ?? applyQueuedDiaryPatch(prev.data.entry, prev.data.todayLocalDate, { dayType: next })!;

      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current);
      }

      setState((s) => {
        if (s.kind !== 'ready') {
          return s;
        }
        const prompt = next === 'headache_day'
          ? 'headache'
          : next === 'migraine_day'
            ? 'migraine'
            : null;
        return {
          ...s,
          data: { ...s.data, entry: saved },
          selection: saved.dayType,
          isSaving: false,
          saveError: null,
          savedTick: s.savedTick + 1,
          showAttackPromptFor: prompt,
        };
      });

      savedTimerRef.current = window.setTimeout(() => {
        setState(s => (s.kind === 'ready' ? { ...s, savedTick: 0 } : s));
        savedTimerRef.current = null;
      }, 1100);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const msg = (() => {
        if (code === 'MIGRAINE_DAY_REQUIRED') {
          return tHome('error_migraine_day_required');
        }
        if (code === 'HEADACHE_FREE_NOT_ALLOWED') {
          return tHome('error_attack_exists_for_day');
        }
        return err instanceof Error ? err.message : tDiary('error_generic');
      })();
      setState(prev);
      setState(s => (s.kind === 'ready' ? { ...s, saveError: msg, isSaving: false } : s));
    }
  };

  const startAttackFromPrompt = async (attackType: 'migraine' | 'headache') => {
    if (state.kind !== 'ready') {
      return;
    }
    try {
      const res = await fetch('/api/quick-add/episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to start attack');
      }
      setLastAttackType(attackType);
      props.onDidLog?.();
      const data = await fetchTodayDiary();
      setState({
        kind: 'ready',
        data,
        selection: data.entry?.dayType ?? null,
        isSaving: false,
        saveError: null,
        savedTick: 0,
        showAttackPromptFor: null,
      });
    } catch (e: any) {
      const msg = e?.message ?? tDiary('error_generic');
      setState(s => (s.kind === 'ready' ? { ...s, saveError: msg } : s));
    }
  };

  return (
    <>
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">{title}</div>
          </div>
          <Link
            href="/dashboard/diary"
            className="min-h-11 shrink-0 rounded-md p-2 text-sm font-medium text-primary hover:bg-muted"
          >
            {tHome('open_diary')}
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {subtitle}
            {headacheFreeStreakDays && headacheFreeStreakDays > 0 && (
              <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                {tHome('headache_free_streak', { days: headacheFreeStreakDays })}
              </div>
            )}
          </div>

          {badge && badgeLabel && (
            <button
              type="button"
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium ring-1 ring-inset ring-border/40',
                badge.className,
              )}
              onClick={() => setInfoOpen(true)}
            >
              <badge.Icon className="size-4" />
              <span>{badgeLabel}</span>
              <HelpCircle className="ml-1 size-4 opacity-70" />
            </button>
          )}
        </div>

        {state.kind === 'loading' && (
          <div className="mt-4 h-12 animate-pulse rounded-xl bg-muted" />
        )}

        {state.kind === 'error' && (
          <div className="mt-4 rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
            {state.message}
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="mt-4 space-y-3">
            {activeTests.length > 0 && (
              <div className="rounded-2xl border bg-muted/60 p-3 text-sm">
                <div className="text-muted-foreground">
                  {tHome('test_mode_banner', {
                    count: activeTests.length,
                    factor: activeTests[0]?.factorName ?? tHome('test_mode_generic_factor'),
                    days: activeTests[0]?.durationDays ?? 14,
                  })}
                </div>
                <div className="mt-2">
                  <Button asChild variant="outline" className="min-h-11">
                    <Link href="/dashboard/insights">{tHome('test_mode_cta')}</Link>
                  </Button>
                </div>
              </div>
            )}
            <div
              className={cn(
                'flex items-center rounded-2xl bg-muted p-1',
                !editable && 'opacity-70',
              )}
              role="group"
              aria-label={tHome('aria_today_status')}
            >
              {([
                { value: 'headache_free' as const, label: tHome('seg_no_pain') },
                { value: 'headache_day' as const, label: tHome('seg_headache') },
                { value: 'migraine_day' as const, label: tHome('seg_migraine') },
              ] as const).map((opt) => {
                const selected = state.selection === opt.value;
                const disabledByUpgradeRule = !canSelect(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-medium transition',
                      selected
                        ? 'bg-card text-foreground shadow-sm ring-1 ring-border/40'
                        : 'text-muted-foreground hover:bg-background/60',
                      disabledByUpgradeRule && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    )}
                    disabled={!editable || state.isSaving}
                    onClick={() => onSelect(opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {showSaved
                  ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                        <Check className="size-3.5" />
                        {tHome('saved')}
                      </span>
                    )
                  : state.isSaving
                    ? tHome('saving')
                    : ' '}
              </div>

              {!editable && (
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" />
                  {tHome('older_days_locked')}
                </div>
              )}
            </div>

            {state.showAttackPromptFor && !props.hasOngoingAttack && (
              <div className="rounded-2xl bg-muted/60 p-3 text-sm">
                <div className="text-muted-foreground">{tHome('add_attack_prompt')}</div>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => startAttackFromPrompt(state.showAttackPromptFor!)}
                  >
                    {tHome('start_attack')}
                  </Button>
                </div>
              </div>
            )}

            {state.saveError && (
              <div className="rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
                {state.saveError}
                {' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setState(s => (s.kind === 'ready' ? { ...s, saveError: null } : s))}
                >
                  {tDiary('try_again')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title={tHome('about_missing_title')}
      >
        <div className="space-y-3 text-sm">
          <div>{tDiary('missing_not_good')}</div>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setInfoOpen(false)}>
            {tHome('got_it')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title={tHome('upgrade_sheet_title')}
      >
        <div className="space-y-3 text-sm">
          <div className="text-muted-foreground">
            {tHome('upgrade_only_explainer')}
          </div>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setUpgradeOpen(false)}>
            {tHome('got_it')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
