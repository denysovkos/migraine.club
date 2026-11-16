'use client';

import type { DiaryDayDetailResponse, DiaryRangeResponse } from './diaryApi';
import type { AttackType } from '@/features/episodes/attackTypePrefs';
import type { EpisodeProtectorFactorKey, EpisodeTriggerFactorKey } from '@/features/episodes/episodeFactorMappings';
import { Brain, Check, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleDot, Droplets, Pencil, Pill } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { fetchCycleCalendar, fetchCycleContext, fetchCycleSettings, saveBleedingDay, updateBleedingFlow } from '@/features/cycle/cycleApi';
import { getLastAttackType, setLastAttackType } from '@/features/episodes/attackTypePrefs';
import {
  PROTECTOR_KEY_TO_VALUE,
  PROTECTOR_VALUE_TO_KEY,
  TRIGGER_KEY_TO_VALUE,
  TRIGGER_VALUE_TO_KEY,
} from '@/features/episodes/episodeFactorMappings';
import { fetchIntake } from '@/features/intake/intakeApi';
import { fetchProgramDetail, fetchProgramSettings } from '@/features/programs/programsApi';
import { EditMedicationIntakeSheet } from '@/features/quickAdd/EditMedicationIntakeSheet';
import { quickAddStartEpisodeNow } from '@/features/quickAdd/quickAddApi';
import { showSnackbar } from '@/features/snackbar';
import { getBuiltInFactorsByType } from '@/services/factors/factorCatalog';
import { sortTriggersByIntake } from '@/services/intake/intakeTriggerPriority';
import { isEditableLocalDate } from '@/services/localDate';

import { cn } from '@/utils/Helpers';
import { applyQueuedDiaryPatch, fetchDiaryDayDetail, fetchDiaryRange, fetchTodayDiary, upsertDiaryEntry } from './diaryApi';

type Entry = NonNullable<DiaryRangeResponse['entries'][number]>;

type DayEditorState = {
  open: boolean;
  localDate: string;
};

function monthLabel(dt: DateTime) {
  return dt.toLocaleString({ month: 'long', year: 'numeric' });
}

function buildMonthGrid(args: { monthStart: DateTime }): DateTime[] {
  const start = args.monthStart.startOf('month');
  const end = args.monthStart.endOf('month');
  const gridStart = start.minus({ days: start.weekday - 1 }); // Monday
  const gridEnd = end.plus({ days: 7 - end.weekday }); // Sunday
  const out: DateTime[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    out.push(cur);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

function renderDayTypeIcon(dayType: string) {
  if (dayType === 'migraine_day') {
    return <Brain className="size-3.5 text-rose-500" aria-hidden />;
  }
  if (dayType === 'headache_day') {
    return <CircleAlert className="size-3.5 text-amber-500" aria-hidden />;
  }
  if (dayType === 'headache_free') {
    return <Check className="size-3.5 text-emerald-500" aria-hidden />;
  }
  return <Circle className="size-3.5 text-muted-foreground" aria-hidden />;
}

export function DiaryView() {
  const t = useTranslations('Diary');
  const tCycle = useTranslations('CycleSettings');
  const tFactors = useTranslations('Factors' as never) as (key: string) => string;
  const tSleep = useTranslations('DiarySleepSection');
  const tOffline = useTranslations('OfflineSync');
  const searchParams = useSearchParams();

  const [timezone, setTimezone] = useState<string | null>(null);
  const [todayLocalDate, setTodayLocalDate] = useState<string | null>(null);

  const [monthStart, setMonthStart] = useState<DateTime | null>(null);
  const [range, setRange] = useState<DiaryRangeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<DayEditorState | null>(null);
  const [dayDetail, setDayDetail] = useState<DiaryDayDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [activeTests, setActiveTests] = useState<Array<{ id: string; factorName: string; durationDays: number }>>([]);
  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [cycleDaysByDate, setCycleDaysByDate] = useState<Map<string, { bleeding: boolean; flow: string }>>(new Map());
  const [cycleContext, setCycleContext] = useState<{
    cycleDay: number | null;
    withinPerimenstrualWindow: boolean;
  } | null>(null);
  const [cycleSaving, setCycleSaving] = useState(false);
  const [savingAttackFactorsId, setSavingAttackFactorsId] = useState<number | null>(null);
  const [intakeEditOpen, setIntakeEditOpen] = useState(false);
  const [intakeEditState, setIntakeEditState] = useState<{
    intakeId: string;
    label: string;
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
    takenAt: Date;
  } | null>(null);
  const isMountedRef = useRef(true);
  const activeEditorDateRef = useRef<string | null>(null);
  const inFlightDayDetailRef = useRef<Map<string, Promise<DiaryDayDetailResponse>>>(new Map());
  const [intakeTriggerKeys, setIntakeTriggerKeys] = useState<string[]>([]);
  const triggerOptions = useMemo(
    () => sortTriggersByIntake(getBuiltInFactorsByType('trigger'), intakeTriggerKeys),
    [intakeTriggerKeys],
  );
  const protectorOptions = useMemo(() => getBuiltInFactorsByType('protector'), []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchIntake()
      .then((dto) => {
        if (mounted) {
          setIntakeTriggerKeys(dto.answers.triggers?.keys ?? []);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Load timezone + today, then default month.
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchTodayDiary()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setTimezone(data.timezone);
        setTodayLocalDate(data.todayLocalDate);
        setMonthStart(DateTime.fromISO(data.todayLocalDate, { zone: data.timezone }).startOf('month'));
      })
      .catch((err) => {
        if (!mounted) {
          return;
        }
        setError(err instanceof Error ? err.message : t('error_generic'));
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [t]);

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

  // Fetch month range when monthStart is set.
  useEffect(() => {
    if (!timezone || !monthStart) {
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);

    const from = monthStart.setZone(timezone).startOf('month').toISODate()!;
    const to = monthStart.setZone(timezone).endOf('month').toISODate()!;

    fetchDiaryRange({ from, to })
      .then((r) => {
        if (!mounted) {
          return;
        }
        setRange(r);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) {
          return;
        }
        setError(err instanceof Error ? err.message : t('error_generic'));
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [monthStart, timezone, t]);

  useEffect(() => {
    if (!monthStart) {
      return;
    }
    let mounted = true;
    const from = monthStart.startOf('month').toISODate()!;
    const to = monthStart.endOf('month').toISODate()!;
    (async () => {
      try {
        const settings = await fetchCycleSettings();
        if (!mounted) {
          return;
        }
        setCycleEnabled(settings.enabled);
        if (!settings.enabled) {
          setCycleDaysByDate(new Map());
          return;
        }
        const calendar = await fetchCycleCalendar({ from, to });
        if (!mounted) {
          return;
        }
        setCycleDaysByDate(new Map(
          calendar.days.map(day => [day.localDate, { bleeding: day.bleeding, flow: day.flow }]),
        ));
      } catch {
        if (mounted) {
          setCycleEnabled(false);
          setCycleDaysByDate(new Map());
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [monthStart]);

  // Open editor from ?date=YYYY-MM-DD
  useEffect(() => {
    const date = searchParams.get('date');
    if (!date || !timezone) {
      return;
    }
    const isValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!isValid) {
      return;
    }
    setEditor((prev) => {
      if (prev?.open && prev.localDate === date) {
        return prev;
      }
      return { open: true, localDate: date };
    });
    // Ensure month is in view
    setMonthStart(DateTime.fromISO(date, { zone: timezone }).startOf('month'));
  }, [searchParams, timezone]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of range?.entries ?? []) {
      if (!e) {
        continue;
      }
      map.set(e.localDate, e as Entry);
    }
    return map;
  }, [range]);

  const gridDays = useMemo(() => {
    if (!timezone || !monthStart) {
      return [];
    }
    return buildMonthGrid({ monthStart: monthStart.setZone(timezone) });
  }, [monthStart, timezone]);

  const monthTitle = useMemo(() => {
    if (!timezone || !monthStart) {
      return '—';
    }
    return monthLabel(monthStart.setZone(timezone));
  }, [monthStart, timezone]);

  const canGoPrev = true;
  const canGoNext = true;

  const openDay = (ymd: string) => setEditor({ open: true, localDate: ymd });

  const closeEditor = () => {
    setEditor(null);
    setSaveError(null);
    setSaving(false);
  };

  const activeEntry = editor ? entriesByDate.get(editor.localDate) ?? null : null;
  const activeCycleDay = editor ? cycleDaysByDate.get(editor.localDate) ?? null : null;
  const isNewEntry = !!editor && !activeEntry;
  const activeHasAttacks = (dayDetail?.attacks?.length ?? 0) > 0;
  const activeHasMigraineAttack = (dayDetail?.attacks ?? []).some(a => a.attackType === 'migraine');
  const activeOngoing = (dayDetail?.attacks ?? []).find(a => a.isOngoing) ?? null;
  const hasLoadedAttackData = !!dayDetail && (dayDetail.attacks?.length ?? 0) > 0;

  const [formDayType, setFormDayType] = useState<'headache_free' | 'headache_day' | 'migraine_day' | null>(null);
  const [formImpact, setFormImpact] = useState<number | null>(null);
  const [formNotes, setFormNotes] = useState<string>('');
  const [formBedTime, setFormBedTime] = useState<string>('');
  const [formWakeTime, setFormWakeTime] = useState<string>('');
  const [sleepTarget, setSleepTarget] = useState<{ bedTime: string; wakeTime: string } | null>(null);

  const [lastAttackType, setLastAttackTypeState] = useState<AttackType>('migraine');
  useEffect(() => {
    const v = getLastAttackType();
    if (v) {
      setLastAttackTypeState(v);
    }
  }, []);

  // Programs module — load sleep target if enrolled. Silent on errors / disabled module.
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
      setSleepTarget({ bedTime: target.bedTime, wakeTime: target.wakeTime });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestedAttackType: AttackType = (() => {
    const fromDayType = formDayType === 'migraine_day'
      ? 'migraine'
      : formDayType === 'headache_day'
        ? 'headache'
        : null;
    return (fromDayType ?? lastAttackType) as AttackType;
  })();

  const [startAttackToggle, setStartAttackToggle] = useState(false);
  useEffect(() => {
    // Reset when opening a different day or after refreshing detail.
    setStartAttackToggle(false);
  }, [editor?.localDate, dayDetail?.attacks?.length]);

  const canStartAttack = (() => {
    if (formDayType === 'headache_free') {
      return false;
    }
    if (!activeOngoing) {
      return true;
    }
    if (activeOngoing.attackType === 'migraine') {
      return false;
    }
    // ongoing headache: only allow "upgrade" if user is starting migraine
    return suggestedAttackType === 'migraine';
  })();

  useEffect(() => {
    if (!canStartAttack && startAttackToggle) {
      setStartAttackToggle(false);
    }
    if (formDayType === 'headache_free' && startAttackToggle) {
      setStartAttackToggle(false);
    }
  }, [canStartAttack, formDayType, startAttackToggle]);

  const showAttackStarter = !activeOngoing && !hasLoadedAttackData && !detailLoading;

  const activeEditable = useMemo(() => {
    if (!editor || !timezone) {
      return false;
    }
    return isEditableLocalDate(editor.localDate as any, new Date(), timezone);
  }, [editor, timezone]);

  const loadDayDetail = useCallback(async (localDate: string) => {
    setDetailLoading(true);
    try {
      const existingRequest = inFlightDayDetailRef.current.get(localDate);
      const request = existingRequest ?? fetchDiaryDayDetail({ date: localDate });
      if (!existingRequest) {
        inFlightDayDetailRef.current.set(localDate, request);
      }
      const d = await request;
      if (!isMountedRef.current || activeEditorDateRef.current !== localDate) {
        return;
      }
      setDayDetail(d);
    } catch {
      if (!isMountedRef.current || activeEditorDateRef.current !== localDate) {
        return;
      }
      setDayDetail(null);
    } finally {
      inFlightDayDetailRef.current.delete(localDate);
      if (isMountedRef.current && activeEditorDateRef.current === localDate) {
        setDetailLoading(false);
      }
    }
  }, []);

  // Fetch day detail whenever editor opens / changes date
  useEffect(() => {
    if (!editor) {
      activeEditorDateRef.current = null;
      setDayDetail(null);
      setDetailLoading(false);
      inFlightDayDetailRef.current.clear();
      return;
    }
    activeEditorDateRef.current = editor.localDate;
    void loadDayDetail(editor.localDate);
  }, [editor, loadDayDetail]);

  useEffect(() => {
    if (!editor || !cycleEnabled) {
      setCycleContext(null);
      return;
    }
    let mounted = true;
    fetchCycleContext(editor.localDate)
      .then((ctx) => {
        if (!mounted) {
          return;
        }
        setCycleContext({
          cycleDay: ctx.cycleDay,
          withinPerimenstrualWindow: ctx.withinPerimenstrualWindow,
        });
      })
      .catch(() => {
        if (mounted) {
          setCycleContext(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, [editor, cycleEnabled]);

  // Reset form when editor opens / activeEntry changes
  useEffect(() => {
    if (!editor) {
      return;
    }
    const e = activeEntry;
    setFormDayType(e?.dayType ?? null);
    setFormImpact(e?.impact ?? null);
    setFormNotes(e?.notes ?? '');
    setFormBedTime((e as any)?.bedTimeLocal ?? '');
    setFormWakeTime((e as any)?.wakeTimeLocal ?? '');
    setSaveError(null);
    setSavedTick(0);
  }, [editor, activeEntry]);

  const save = async (patch: Record<string, any>) => {
    if (!editor) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await upsertDiaryEntry({ localDate: editor.localDate, patch });
      if (!result) {
        showSnackbar({ message: tOffline('saved_offline') });
      }
      // Update local cache (range)
      setRange((prev) => {
        if (!prev) {
          return prev;
        }
        const saved = result ?? applyQueuedDiaryPatch(
          (prev.entries ?? []).find(e => e?.localDate === editor.localDate),
          editor.localDate,
          patch,
        );
        if (!saved) {
          return prev;
        }
        const without = (prev.entries ?? []).filter(e => e && e.localDate !== saved.localDate);
        return { ...prev, entries: [...without, saved].sort((a, b) => (a!.localDate).localeCompare(b!.localDate)) } as any;
      });
      setSavedTick(x => x + 1);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('error_generic'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = async () => {
    if (!formDayType) {
      setSaveError(t('select_day_type_first'));
      return;
    }
    const patch: any = {
      ...(formDayType ? { dayType: formDayType } : {}),
      notes: formNotes.trim() ? formNotes : null,
      impact: formImpact,
      ...(sleepTarget ? { bedTimeLocal: formBedTime || null, wakeTimeLocal: formWakeTime || null } : {}),
    };
    const ok = await save(patch);
    if (!ok) {
      return;
    }

    // Only create an episode AFTER the diary entry has been saved.
    if (startAttackToggle) {
      try {
        const isToday = !!(todayLocalDate && editor?.localDate === todayLocalDate);
        const started = await quickAddStartEpisodeNow({
          attackType: suggestedAttackType,
          ...(isToday ? {} : { localDate: editor?.localDate }),
        });
        if (started.queued) {
          showSnackbar({ message: tOffline('saved_offline') });
        }
        setLastAttackType(suggestedAttackType);
        setLastAttackTypeState(suggestedAttackType);

        // Update month markers optimistically (attack dot)
        if (editor?.localDate) {
          setRange((prev) => {
            if (!prev) {
              return prev;
            }
            const attackDays = new Set(prev.attackDays ?? []);
            attackDays.add(editor.localDate);
            return { ...prev, attackDays: [...attackDays].sort() } as any;
          });
        }
      } catch (e: any) {
        setSaveError(e?.message ?? t('error_generic'));
        return;
      }
    }

    closeEditor();
  };

  return (
    <div className="space-y-4">
      {activeTests.length > 0 && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <div className="text-muted-foreground">
            {t('test_mode_banner', {
              count: activeTests.length,
              factor: activeTests[0]?.factorName ?? t('test_mode_generic_factor'),
              days: activeTests[0]?.durationDays ?? 14,
            })}
          </div>
          <div className="mt-2">
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/dashboard/insights">{t('test_mode_cta')}</Link>
            </Button>
          </div>
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 min-w-12 px-3"
            onClick={() => setMonthStart(m => (m ?? DateTime.now()).minus({ months: 1 }))}
            disabled={!canGoPrev || loading}
            aria-label={t('prev_month')}
          >
            <ChevronLeft className="size-5" />
          </Button>

          <div className="min-w-0 text-center">
            <div className="text-sm font-medium">{monthTitle}</div>
            {range && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('coverage_label', { recorded: range.coverage.recordedDays, total: range.coverage.totalDays, missing: range.coverage.missingDays })}
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 min-w-12 px-3"
            onClick={() => setMonthStart(m => (m ?? DateTime.now()).plus({ months: 1 }))}
            disabled={!canGoNext || loading}
            aria-label={t('next_month')}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4 lg:grid-cols-7">
          <div className="flex items-center gap-2">
            <Brain className="size-3.5 text-rose-500" />
            {t('legend_migraine_day')}
          </div>
          <div className="flex items-center gap-2">
            <CircleAlert className="size-3.5 text-amber-500" />
            {t('legend_headache_day')}
          </div>
          <div className="flex items-center gap-2">
            <Check className="size-3.5 text-emerald-500" />
            {t('legend_headache_free')}
          </div>
          <div className="flex items-center gap-2">
            <Circle className="size-3.5" />
            {t('legend_missing')}
          </div>
          <div className="flex items-center gap-2">
            <Droplets className="size-3.5 text-rose-300" />
            {t('legend_bleeding')}
          </div>
          <div className="flex items-center gap-2">
            <CircleDot className="size-3.5 text-sky-500" />
            {t('attack_indicator')}
          </div>
          <div className="flex items-center gap-2">
            <Pill className="size-3.5 text-violet-500" />
            {t('medication_indicator')}
          </div>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {t('missing_not_good')}
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border bg-card p-4">
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && timezone && monthStart && (
        <div className="rounded-xl border bg-card p-3">
          <div className="grid grid-cols-7 gap-2 px-1 pb-2 text-center text-xs font-medium text-muted-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {gridDays.map((d) => {
              const ymd = d.toISODate()!;
              const inMonth = d.month === monthStart.month;
              const entry = entriesByDate.get(ymd) ?? null;
              const dayType = entry?.dayType ?? 'missing';
              const hasEntry = !!entry;
              const hasAttack = (range?.attackDays ?? []).includes(ymd);
              const hasMeds = (range?.medicationDays ?? []).includes(ymd);
              const isBleeding = cycleDaysByDate.get(ymd)?.bleeding ?? false;

              // Click/disabled rules:
              // - Future days are not clickable.
              // - Past days older than the editable window are not clickable *when missing* (no backfill).
              // - Existing entries can still be opened (read-only) even if older than window.
              const isFuture = todayLocalDate ? ymd > todayLocalDate : true;
              const isEditable = !isFuture && isEditableLocalDate(ymd as any, new Date(), timezone);
              const canOpen = !isFuture && (isEditable || hasEntry);

              return (
                <button
                  key={ymd}
                  type="button"
                  className={cn(
                    'relative flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-2 text-sm',
                    'hover:bg-muted active:scale-[0.98]',
                    !inMonth && 'opacity-40',
                    !canOpen && 'cursor-not-allowed bg-muted/30 text-muted-foreground hover:bg-muted/30 active:scale-100',
                  )}
                  disabled={!canOpen}
                  onClick={() => openDay(ymd)}
                  aria-label={ymd}
                >
                  <div className="text-sm tabular-nums">{d.day}</div>
                  <div className="mt-1">{renderDayTypeIcon(dayType)}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                    {hasAttack && <CircleDot className="size-3 text-sky-500" aria-label={t('attack_indicator')} />}
                    {hasMeds && <Pill className="size-3 text-violet-500" aria-label={t('medication_indicator')} />}
                    {isBleeding && <Droplets className="size-3 text-rose-400" aria-label={t('legend_bleeding')} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <BottomSheet
        open={!!editor?.open}
        onOpenChange={(open) => {
          if (!open) {
            closeEditor();
          }
        }}
        title={(() => {
          if (!editor || !timezone) {
            return t('day_title_fallback');
          }
          return DateTime.fromISO(editor.localDate, { zone: timezone }).toLocaleString(DateTime.DATE_FULL);
        })()}
      >
        {!editor && null}
        {editor && (
          <div className="space-y-4">
            {/* Day classification */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {t('day_type_label')}
                {' '}
                <span className="font-medium text-foreground">
                  {activeEntry === null
                    ? t('day_type_missing')
                    : activeEntry.dayType === 'headache_free'
                      ? t('day_type_headache_free')
                      : activeEntry.dayType === 'headache_day'
                        ? t('day_type_headache_day')
                        : t('day_type_migraine_day')}
                </span>
                {activeEntry?.createdFrom === 'attack' && (
                  <span className="ml-2 text-xs text-muted-foreground">{t('recorded_from_attack')}</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 whitespace-normal px-2 text-sm leading-tight"
                  variant={formDayType === 'headache_free' ? 'default' : 'outline'}
                  disabled={!activeEditable || saving || activeHasAttacks}
                  onClick={async () => {
                    setFormDayType('headache_free');
                    if (!isNewEntry) {
                      await save({ dayType: 'headache_free' });
                    }
                  }}
                >
                  {t('day_type_headache_free_short')}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 whitespace-normal px-2 text-sm leading-tight"
                  variant={formDayType === 'headache_day' ? 'default' : 'outline'}
                  disabled={!activeEditable || saving || activeHasMigraineAttack}
                  onClick={async () => {
                    setFormDayType('headache_day');
                    if (!isNewEntry) {
                      await save({ dayType: 'headache_day' });
                    }
                  }}
                >
                  {t('day_type_headache_day_short')}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 whitespace-normal px-2 text-sm leading-tight"
                  variant={formDayType === 'migraine_day' ? 'default' : 'outline'}
                  disabled={!activeEditable || saving}
                  onClick={async () => {
                    setFormDayType('migraine_day');
                    if (!isNewEntry) {
                      await save({ dayType: 'migraine_day' });
                    }
                  }}
                >
                  {t('day_type_migraine_day_short')}
                </Button>
              </div>

              {activeHasAttacks && (
                <div className="text-xs text-muted-foreground">
                  {t('headache_free_disabled_because_attack')}
                </div>
              )}

              {activeHasMigraineAttack && (
                <div className="text-xs text-muted-foreground">
                  {t('headache_day_disabled_because_migraine_attack')}
                </div>
              )}
            </div>

            {!activeEditable && (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                {t('read_only_explainer')}
              </div>
            )}

            {cycleEnabled && (
              <div className="rounded-lg border bg-card p-3">
                <div className="text-sm font-medium">{t('cycle_context_title')}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {cycleContext?.cycleDay
                    ? t('cycle_context_day', { day: cycleContext.cycleDay })
                    : t('cycle_context_unknown')}
                  {cycleContext?.withinPerimenstrualWindow ? ` · ${t('cycle_context_window')}` : ''}
                </div>
                <div className="mt-2">
                  <Button asChild size="sm" variant="outline" className="min-h-11">
                    <Link href="/dashboard/diary">{t('cycle_context_edit')}</Link>
                  </Button>
                </div>
              </div>
            )}

            {cycleEnabled && editor && (
              <div className="rounded-lg border bg-card p-3">
                <div className="text-sm font-medium">{t('legend_bleeding')}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {activeCycleDay?.bleeding ? tCycle('today_chip_on') : tCycle('today_chip_off')}
                  </div>
                  <Switch
                    checked={!!activeCycleDay?.bleeding}
                    disabled={cycleSaving}
                    onCheckedChange={async (bleeding) => {
                      try {
                        setCycleSaving(true);
                        const updated = await saveBleedingDay({
                          localDate: editor.localDate,
                          bleeding,
                          flow: (activeCycleDay?.flow as any) ?? 'unspecified',
                        });
                        setCycleDaysByDate((prev) => {
                          const copy = new Map(prev);
                          copy.set(editor.localDate, { bleeding: updated.bleeding, flow: updated.flow });
                          return copy;
                        });
                        const ctx = await fetchCycleContext(editor.localDate);
                        setCycleContext({
                          cycleDay: ctx.cycleDay,
                          withinPerimenstrualWindow: ctx.withinPerimenstrualWindow,
                        });
                      } finally {
                        setCycleSaving(false);
                      }
                    }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['unspecified', 'light', 'medium', 'heavy'] as const).map(flow => (
                    <Button
                      key={`diary-flow-${flow}`}
                      type="button"
                      variant={activeCycleDay?.flow === flow ? 'default' : 'outline'}
                      className="min-h-11"
                      disabled={cycleSaving}
                      onClick={async () => {
                        try {
                          setCycleSaving(true);
                          const updated = await updateBleedingFlow({ localDate: editor.localDate, flow });
                          setCycleDaysByDate((prev) => {
                            const copy = new Map(prev);
                            copy.set(editor.localDate, { bleeding: updated.bleeding, flow: updated.flow });
                            return copy;
                          });
                        } finally {
                          setCycleSaving(false);
                        }
                      }}
                    >
                      {flow === 'unspecified'
                        ? tCycle('flow_options.unspecified')
                        : flow === 'light'
                          ? tCycle('flow_options.light')
                          : flow === 'medium'
                            ? tCycle('flow_options.medium')
                            : tCycle('flow_options.heavy')}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Attacks */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t('attacks_title')}</div>
                {showAttackStarter
                  ? (
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground">
                          {suggestedAttackType === 'migraine'
                            ? t('will_start_attack_migraine')
                            : t('will_start_attack_headache')}
                        </div>
                        <Switch
                          checked={startAttackToggle}
                          disabled={!activeEditable || saving || !canStartAttack}
                          onCheckedChange={checked => setStartAttackToggle(checked)}
                        />
                      </div>
                    )
                  : (
                      <div className="text-xs text-muted-foreground">
                        {activeOngoing
                          ? (activeOngoing.attackType === 'migraine'
                              ? t('ongoing_attack_migraine')
                              : t('ongoing_attack_headache'))
                          : t('loading_existing_attack')}
                      </div>
                    )}
              </div>

              <div className="text-xs text-muted-foreground">
                {t('attacks_helper')}
              </div>

              {detailLoading && !hasLoadedAttackData && (
                <div className="h-10 animate-pulse rounded-lg bg-muted" />
              )}

              {!detailLoading && (!dayDetail || dayDetail.attacks.length === 0) && (
                <div className="text-sm text-muted-foreground">{t('no_attacks')}</div>
              )}

              {dayDetail && dayDetail.attacks.length > 0 && (
                <div className="space-y-2">
                  {dayDetail.attacks.map(a => (
                    <div key={a.id} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {a.attackType === 'migraine' ? t('migraine') : t('headache')}
                            {a.isOngoing ? ` · ${t('in_progress')}` : ''}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {DateTime.fromISO(a.startTime, { zone: timezone ?? undefined }).toLocaleString(DateTime.TIME_SIMPLE)}
                            {' '}
                            —
                            {' '}
                            {a.endTime
                              ? DateTime.fromISO(a.endTime, { zone: timezone ?? undefined }).toLocaleString(DateTime.TIME_SIMPLE)
                              : t('ongoing')}
                            {' '}
                            ·
                            {' '}
                            {t('intensity_short', { value: a.intensity })}
                          </div>
                        </div>
                        {a.isOngoing && (
                          <Button
                            type="button"
                            size="sm"
                            className="min-h-11"
                            onClick={async () => {
                              await fetch(`/api/episodes/${a.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ endNow: true }),
                              });
                              if (editor) {
                                const d = await fetchDiaryDayDetail({ date: editor.localDate });
                                setDayDetail(d);
                                if (timezone && monthStart) {
                                  const from = monthStart.setZone(timezone).startOf('month').toISODate()!;
                                  const to = monthStart.setZone(timezone).endOf('month').toISODate()!;
                                  setRange(await fetchDiaryRange({ from, to }));
                                }
                              }
                            }}
                          >
                            {t('end_attack')}
                          </Button>
                        )}
                      </div>
                      <div className="mt-2">
                        <Button asChild size="sm" variant="outline" className="min-h-11">
                          <a href={`/dashboard/episodes/${a.id}`}>{t('edit_attack')}</a>
                        </Button>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="text-sm font-medium">{t('attack_factors_title')}</div>
                        <div className="text-xs text-muted-foreground">{t('attack_factors_helper')}</div>
                        <div className="flex flex-wrap gap-2">
                          {triggerOptions.map((trigger) => {
                            const triggerKey = trigger.key as EpisodeTriggerFactorKey;
                            const selectedTriggerKeys = (a.triggers ?? [])
                              .map(triggerValue => TRIGGER_VALUE_TO_KEY[triggerValue as keyof typeof TRIGGER_VALUE_TO_KEY])
                              .filter(Boolean);
                            const isSelected = selectedTriggerKeys.includes(triggerKey);
                            return (
                              <Button
                                key={`${a.id}-trigger-${trigger.key}`}
                                type="button"
                                size="sm"
                                variant={isSelected ? 'default' : 'outline'}
                                aria-pressed={isSelected}
                                disabled={savingAttackFactorsId === a.id}
                                onClick={async () => {
                                  const nextTriggers = isSelected
                                    ? selectedTriggerKeys.filter(key => key !== triggerKey)
                                    : [...selectedTriggerKeys, triggerKey];
                                  setSavingAttackFactorsId(a.id);
                                  try {
                                    const res = await fetch(`/api/episodes/${a.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        triggers: nextTriggers.map(key => TRIGGER_KEY_TO_VALUE[key]),
                                      }),
                                    });
                                    if (!res.ok) {
                                      throw new Error('Failed to save attack factors');
                                    }
                                    const updated = await res.json();
                                    setDayDetail((prev) => {
                                      if (!prev) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        attacks: prev.attacks.map(attack => (
                                          attack.id === a.id
                                            ? {
                                                ...attack,
                                                triggers: updated.triggers ?? [],
                                                protectors: updated.protectors ?? [],
                                              }
                                            : attack
                                        )),
                                      };
                                    });
                                  } catch (error) {
                                    showSnackbar({
                                      message: error instanceof Error ? error.message : t('error_generic'),
                                    });
                                  } finally {
                                    setSavingAttackFactorsId(null);
                                  }
                                }}
                              >
                                {tFactors(`builtins.trigger.${trigger.key}`)}
                              </Button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {protectorOptions.map((protector) => {
                            const protectorKey = protector.key as EpisodeProtectorFactorKey;
                            const selectedProtectorKeys = (a.protectors ?? [])
                              .map(protectorValue => PROTECTOR_VALUE_TO_KEY[protectorValue as keyof typeof PROTECTOR_VALUE_TO_KEY])
                              .filter(Boolean);
                            const isSelected = selectedProtectorKeys.includes(protectorKey);
                            return (
                              <Button
                                key={`${a.id}-protector-${protector.key}`}
                                type="button"
                                size="sm"
                                variant={isSelected ? 'default' : 'outline'}
                                aria-pressed={isSelected}
                                disabled={savingAttackFactorsId === a.id}
                                onClick={async () => {
                                  const nextProtectors = isSelected
                                    ? selectedProtectorKeys.filter(key => key !== protectorKey)
                                    : [...selectedProtectorKeys, protectorKey];
                                  setSavingAttackFactorsId(a.id);
                                  try {
                                    const res = await fetch(`/api/episodes/${a.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        protectors: nextProtectors.map(key => PROTECTOR_KEY_TO_VALUE[key]),
                                      }),
                                    });
                                    if (!res.ok) {
                                      throw new Error('Failed to save attack factors');
                                    }
                                    const updated = await res.json();
                                    setDayDetail((prev) => {
                                      if (!prev) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        attacks: prev.attacks.map(attack => (
                                          attack.id === a.id
                                            ? {
                                                ...attack,
                                                triggers: updated.triggers ?? [],
                                                protectors: updated.protectors ?? [],
                                              }
                                            : attack
                                        )),
                                      };
                                    });
                                  } catch (error) {
                                    showSnackbar({
                                      message: error instanceof Error ? error.message : t('error_generic'),
                                    });
                                  } finally {
                                    setSavingAttackFactorsId(null);
                                  }
                                }}
                              >
                                {tFactors(`builtins.protector.${protector.key === 'physical_activity' ? 'exercise' : protector.key === 'other_protector' ? 'other' : protector.key}`)}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Medications */}
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('medications_title')}</div>
              {detailLoading && <div className="h-10 animate-pulse rounded-lg bg-muted" />}
              {!detailLoading && (!dayDetail || dayDetail.medicationIntakes.length === 0) && (
                <div className="text-sm text-muted-foreground">{t('no_medications')}</div>
              )}
              {!detailLoading && dayDetail && dayDetail.medicationIntakes.length > 0 && (
                <div className="space-y-2">
                  {dayDetail.medicationIntakes.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.label}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {DateTime.fromISO(m.takenAt, { zone: timezone ?? undefined }).toLocaleString(DateTime.TIME_SIMPLE)}
                          {(m.dose || m.unit) ? ` · ${[m.dose, m.unit].filter(Boolean).join(' ')}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted"
                        aria-label={`Edit ${m.label}`}
                        onClick={() => {
                          setIntakeEditState({
                            intakeId: m.id,
                            label: m.label,
                            dose: m.dose,
                            unit: m.unit,
                            unitIsCustom: m.unitIsCustom,
                            takenAt: new Date(m.takenAt),
                          });
                          setIntakeEditOpen(true);
                        }}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes + Impact */}
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">{t('impact')}</div>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {[0, 1, 2, 3, 4].map(v => (
                    <Button
                      key={v}
                      type="button"
                      variant={(formImpact ?? null) === v ? 'default' : 'outline'}
                      className="min-h-11"
                      disabled={!activeEditable || saving}
                      onClick={() => setFormImpact(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </div>

              {sleepTarget && (
                <div className="rounded-lg border border-sky-300 bg-sky-50/40 p-3 dark:border-sky-700 dark:bg-sky-950/20">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    {tSleep('header', { bed: sleepTarget.bedTime, wake: sleepTarget.wakeTime })}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <span className="text-xs">
                      <div className="mb-1 text-muted-foreground">{tSleep('bed_time')}</div>
                      <Input
                        type="time"
                        value={formBedTime}
                        onChange={e => setFormBedTime(e.target.value)}
                        disabled={!activeEditable || saving}
                        className="min-h-11"
                      />
                    </span>
                    <span className="text-xs">
                      <div className="mb-1 text-muted-foreground">{tSleep('wake_time')}</div>
                      <Input
                        type="time"
                        value={formWakeTime}
                        onChange={e => setFormWakeTime(e.target.value)}
                        disabled={!activeEditable || saving}
                        className="min-h-11"
                      />
                    </span>
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm font-medium">{t('notes')}</div>
                <Input
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder={t('notes_placeholder')}
                  disabled={!activeEditable || saving}
                  className="mt-2 min-h-12"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12"
                  disabled={!activeEditable || saving}
                  onClick={onSaveClick}
                >
                  {saving ? t('saving') : t('save')}
                </Button>
                {savedTick > 0 && !saving && !saveError && (
                  <div className="text-sm text-emerald-700">{t('saved')}</div>
                )}
              </div>

              {saveError && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {saveError}
                </div>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      <EditMedicationIntakeSheet
        open={intakeEditOpen}
        onOpenChange={setIntakeEditOpen}
        intakeId={intakeEditState?.intakeId ?? null}
        label={intakeEditState?.label ?? 'Medication'}
        initialDose={intakeEditState?.dose ?? null}
        initialUnit={intakeEditState?.unit ?? null}
        initialUnitIsCustom={intakeEditState?.unitIsCustom ?? false}
        initialTakenAt={intakeEditState?.takenAt ?? null}
        onSaved={() => {
          if (editor) {
            loadDayDetail(editor.localDate);
          }
        }}
      />
    </div>
  );
}
