'use client';

import type { IntakeFrequencyBandType } from '@/models/intake';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchIntake } from '@/features/intake/intakeApi';

type OutcomesResponse = {
  windowDays: number;
  timezone: string;
  totals: {
    mmdMin: number;
    mmdMax: number;
    mhdMin: number;
    mhdMax: number;
    acuteMedicationDays: number;
    coverage: { totalDays: number; recordedDays: number; missingDays: number };
  };
  daily: Array<{
    date: string;
    dayType: 'headache_free' | 'headache_day' | 'migraine_day' | null;
    tookMedication: boolean;
    medications: string[];
  }>;
  baseline?: { from: string; to: string; mmd: number; mhd: number };
  responder50?: { status: 'YES' | 'NO' | 'NA'; reason?: 'INSUFFICIENT_COVERAGE'; baselineMmd?: number; currentMmd?: number };
};

type SettingsResponse = {
  baselineStart: string | null;
  baselineEnd: string | null;
  preferredWindowDays: number;
  timezone: string;
};

function ymd(dt: DateTime): string {
  return dt.toISODate()!;
}

function formatMonthLabel(month: string): string {
  // month is YYYY-MM
  const dt = DateTime.fromFormat(month, 'yyyy-MM', { zone: 'UTC' });
  return dt.isValid ? dt.toFormat('LLL yy') : month;
}

function classForHeatCell(d: { dayType: 'headache_free' | 'headache_day' | 'migraine_day' | null; tookMedication: boolean }): string {
  const isMissing = d.dayType === null;
  const isMigraine = d.dayType === 'migraine_day';
  const isHeadache = d.dayType === 'headache_day';
  const isHeadacheFree = d.dayType === 'headache_free';

  if (isMissing) {
    return 'bg-transparent border border-dashed border-muted-foreground/40';
  }
  if ((isMigraine || isHeadache) && d.tookMedication) {
    return 'bg-violet-400';
  }
  if (isMigraine) {
    return 'bg-rose-400';
  }
  if (isHeadache) {
    return 'bg-amber-300';
  }
  if (isHeadacheFree) {
    return d.tookMedication ? 'bg-sky-300' : 'bg-emerald-200';
  }
  if (d.tookMedication) {
    return 'bg-sky-300';
  }
  return 'bg-muted';
}

export function OutcomesView() {
  const t = useTranslations('Outcomes');
  const tIntake = useTranslations('Intake');
  const [selfReportedBand, setSelfReportedBand] = useState<IntakeFrequencyBandType | null>(null);
  const [rangeFrom, setRangeFrom] = useState<string>('');
  const [rangeTo, setRangeTo] = useState<string>('');
  const [rangePreset, setRangePreset] = useState<'month' | '60' | '90' | 'custom'>('month');
  const [rangeInitialized, setRangeInitialized] = useState(false);

  const [summary, setSummary] = useState<OutcomesResponse | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [baselineFrom, setBaselineFrom] = useState<string>('');
  const [baselineTo, setBaselineTo] = useState<string>('');
  const [savingBaseline, setSavingBaseline] = useState(false);

  const effectiveTimezone = summary?.timezone ?? settings?.timezone ?? 'UTC';

  const todayYmd = useMemo(() => {
    return ymd(DateTime.now().setZone(effectiveTimezone).startOf('day'));
  }, [effectiveTimezone]);

  // Default range: current month (from month start to today)
  useEffect(() => {
    if (rangeInitialized) {
      return;
    }
    const now = DateTime.now().setZone(effectiveTimezone).startOf('day');
    setRangeFrom(ymd(now.startOf('month')));
    setRangeTo(ymd(now));
    setRangePreset('month');
    setRangeInitialized(true);
  }, [effectiveTimezone, rangeInitialized]);

  // Fetched once: the self-reported baseline is a remembered figure from
  // onboarding, never a measurement, so it's kept out of the fetchAll/summary
  // data flow that feeds the measured MMD/MHD figures and chart series.
  useEffect(() => {
    let mounted = true;
    fetchIntake()
      .then((dto) => {
        if (mounted) {
          setSelfReportedBand(dto.answers.frequency?.band ?? null);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const effectiveFromTo = useMemo(() => {
    return {
      from: rangeFrom || todayYmd,
      to: rangeTo || todayYmd,
    };
  }, [rangeFrom, rangeTo, todayYmd]);

  const windowDays = useMemo(() => {
    const from = DateTime.fromISO(effectiveFromTo.from, { zone: effectiveTimezone }).startOf('day');
    const to = DateTime.fromISO(effectiveFromTo.to, { zone: effectiveTimezone }).startOf('day');
    const diff = Math.max(0, Math.round(to.diff(from, 'days').days));
    return diff + 1;
  }, [effectiveFromTo.from, effectiveFromTo.to, effectiveTimezone]);

  const fetchAll = useCallback(async (opts?: { from: string; to: string }) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/outcomes', window.location.origin);
      const from = opts?.from ?? effectiveFromTo.from;
      const to = opts?.to ?? effectiveFromTo.to;
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      url.searchParams.set('windowDays', String(windowDays));

      const [outcomesRes, settingsRes] = await Promise.all([
        fetch(url.toString()),
        fetch('/api/outcomes/settings'),
      ]);

      if (!outcomesRes.ok) {
        const e = await outcomesRes.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to load outcomes');
      }
      if (!settingsRes.ok) {
        const e = await settingsRes.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to load settings');
      }

      const outcomesJson = (await outcomesRes.json()) as OutcomesResponse;
      const settingsJson = (await settingsRes.json()) as SettingsResponse;

      setSummary(outcomesJson);
      setSettings(settingsJson);

      if (settingsJson.baselineStart) {
        setBaselineFrom(DateTime.fromISO(settingsJson.baselineStart).toISODate()!);
      }
      if (settingsJson.baselineEnd) {
        setBaselineTo(DateTime.fromISO(settingsJson.baselineEnd).toISODate()!);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error_generic'));
    } finally {
      setLoading(false);
    }
  }, [effectiveFromTo.from, effectiveFromTo.to, t, windowDays]);

  useEffect(() => {
    if (!rangeInitialized) {
      return;
    }
    fetchAll({ from: effectiveFromTo.from, to: effectiveFromTo.to }).catch(() => {});
  }, [effectiveFromTo.from, effectiveFromTo.to, fetchAll, rangeInitialized]);

  const saveBaseline = async () => {
    setSavingBaseline(true);
    try {
      const res = await fetch('/api/outcomes/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baselineFrom: baselineFrom || null,
          baselineTo: baselineTo || null,
          preferredWindowDays: windowDays,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to save baseline');
      }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error_generic'));
    } finally {
      setSavingBaseline(false);
    }
  };

  const responderLabel = summary?.responder50?.status
    ? ({
        YES: t('responder_yes'),
        NO: t('responder_no'),
        NA: summary?.responder50?.reason === 'INSUFFICIENT_COVERAGE'
          ? t('responder_insufficient_coverage')
          : t('responder_na'),
      } as const)[summary.responder50.status]
    : t('responder_not_configured');

  const monthChartData = useMemo(() => {
    const byMonth = new Map<string, { mmd: number; mhd: number; meds: number }>();
    for (const d of summary?.daily ?? []) {
      const month = d.date.slice(0, 7); // YYYY-MM
      const cur = byMonth.get(month) ?? { mmd: 0, mhd: 0, meds: 0 };
      const isMigraineDay = d.dayType === 'migraine_day';
      const isHeadacheDay = d.dayType === 'headache_day';
      cur.mmd += isMigraineDay ? 1 : 0;
      cur.mhd += (isMigraineDay || isHeadacheDay) ? 1 : 0;
      cur.meds += d.tookMedication ? 1 : 0;
      byMonth.set(month, cur);
    }
    const months = [...byMonth.keys()].sort();
    return months.map(month => ({
      month,
      monthLabel: formatMonthLabel(month),
      mmd: byMonth.get(month)!.mmd,
      mhd: byMonth.get(month)!.mhd,
      meds: byMonth.get(month)!.meds,
    }));
  }, [summary]);

  const dailyByDate = useMemo(() => {
    const map = new Map<string, { dayType: 'headache_free' | 'headache_day' | 'migraine_day' | null; tookMedication: boolean; medications: string[] }>();
    for (const d of summary?.daily ?? []) {
      map.set(d.date, {
        dayType: d.dayType,
        tookMedication: d.tookMedication,
        medications: d.medications ?? [],
      });
    }
    return map;
  }, [summary]);

  const calendarMonths = useMemo(() => {
    const from = DateTime.fromISO(effectiveFromTo.from, { zone: effectiveTimezone }).startOf('day');
    const to = DateTime.fromISO(effectiveFromTo.to, { zone: effectiveTimezone }).startOf('day');
    const startMonth = from.startOf('month');
    const endMonth = to.startOf('month');
    const out: DateTime[] = [];
    let cur = startMonth;
    while (cur <= endMonth) {
      out.push(cur);
      cur = cur.plus({ months: 1 });
    }
    return out;
  }, [effectiveFromTo.from, effectiveFromTo.to, effectiveTimezone]);

  const monthGrids = useMemo(() => {
    return calendarMonths.map((m) => {
      const monthStart = m.startOf('month');
      const monthEnd = m.endOf('month').startOf('day');
      const gridStart = monthStart.startOf('week'); // Monday
      const gridEnd = monthEnd.endOf('week').startOf('day');
      const days: Array<{ date: string; inMonth: boolean; inRange: boolean; isToday: boolean }> = [];
      let cur = gridStart;
      while (cur <= gridEnd) {
        const iso = cur.toISODate()!;
        const inMonth = cur.month === monthStart.month;
        const inRange = iso >= effectiveFromTo.from && iso <= effectiveFromTo.to;
        const isToday = iso === todayYmd;
        days.push({ date: iso, inMonth, inRange, isToday });
        cur = cur.plus({ days: 1 });
      }
      return { month: m.toFormat('yyyy-MM'), label: m.toFormat('LLLL yyyy'), days };
    });
  }, [calendarMonths, effectiveFromTo.from, effectiveFromTo.to, todayYmd]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Window selector */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button
              type="button"
              variant={rangePreset === 'month' ? 'default' : 'outline'}
              onClick={() => {
                const now = DateTime.now().setZone(effectiveTimezone).startOf('day');
                setRangeFrom(ymd(now.startOf('month')));
                setRangeTo(ymd(now));
                setRangePreset('month');
              }}
              className="w-full whitespace-normal px-3 text-xs leading-tight"
            >
              {t('range_current_month')}
            </Button>
            <Button
              type="button"
              variant={rangePreset === '60' ? 'default' : 'outline'}
              onClick={() => {
                const now = DateTime.now().setZone(effectiveTimezone).startOf('day');
                setRangeFrom(ymd(now.minus({ months: 1 }).startOf('month')));
                setRangeTo(ymd(now));
                setRangePreset('60');
              }}
              className="w-full whitespace-normal px-3 text-xs leading-tight"
            >
              {t('range_last_60')}
            </Button>
            <Button
              type="button"
              variant={rangePreset === '90' ? 'default' : 'outline'}
              onClick={() => {
                const now = DateTime.now().setZone(effectiveTimezone).startOf('day');
                setRangeFrom(ymd(now.minus({ months: 2 }).startOf('month')));
                setRangeTo(ymd(now));
                setRangePreset('90');
              }}
              className="col-span-2 w-full whitespace-normal px-3 text-xs leading-tight sm:col-span-1"
            >
              {t('range_last_90')}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end sm:gap-2">
            <Input
              type="date"
              value={rangeFrom}
              onChange={(e) => {
                setRangeFrom(e.target.value);
                setRangePreset('custom');
              }}
              className="h-11 w-full sm:w-40"
              aria-label={t('custom_from')}
            />
            <Input
              type="date"
              value={rangeTo}
              onChange={(e) => {
                setRangeTo(e.target.value);
                setRangePreset('custom');
              }}
              className="h-11 w-full sm:w-40"
              aria-label={t('custom_to')}
            />
          </div>
        </div>

        {/* Summary card */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-muted-foreground">{t('summary_title')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('timezone_label', { timezone: summary.timezone })}
              </div>
            </div>

            <div className="grid grid-cols-3 items-start gap-3 sm:gap-4">
              <div className="flex min-h-[4.75rem] flex-col justify-between">
                <div className="min-h-11 text-xs leading-snug text-muted-foreground">
                  {t('mmd')}
                </div>
                <div className="text-2xl font-semibold tabular-nums leading-none">
                  {summary.totals.mmdMin === summary.totals.mmdMax
                    ? summary.totals.mmdMin
                    : `${summary.totals.mmdMin}–${summary.totals.mmdMax}`}
                </div>
              </div>
              <div className="flex min-h-[4.75rem] flex-col justify-between">
                <div className="min-h-11 text-xs leading-snug text-muted-foreground">
                  {t('mhd')}
                </div>
                <div className="text-2xl font-semibold tabular-nums leading-none">
                  {summary.totals.mhdMin === summary.totals.mhdMax
                    ? summary.totals.mhdMin
                    : `${summary.totals.mhdMin}–${summary.totals.mhdMax}`}
                </div>
              </div>
              <div className="flex min-h-[4.75rem] flex-col justify-between">
                <div className="min-h-11 text-xs leading-snug text-muted-foreground">
                  {t('med_days')}
                </div>
                <div className="text-2xl font-semibold tabular-nums leading-none">{summary.totals.acuteMedicationDays}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {t('coverage_summary', {
              recorded: summary.totals.coverage.recordedDays,
              total: summary.totals.coverage.totalDays,
              missing: summary.totals.coverage.missingDays,
            })}
          </div>

          <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-medium">{t('responder_title')}</div>
              <div className="text-muted-foreground">
                {responderLabel}
              </div>
            </div>
            {summary.baseline && (
              <div className="mt-1 text-xs text-muted-foreground">
                {t('responder_detail', {
                  baselineFrom: summary.baseline.from,
                  baselineTo: summary.baseline.to,
                  baselineMmd: summary.baseline.mmd,
                  currentMmd: summary.totals.mmdMin,
                })}
              </div>
            )}
          </div>
        </div>

        {/* Self-reported baseline: a remembered figure from onboarding, not a
            measurement. Kept in its own card, never merged into the measured
            MMD/MHD totals above or any chart series below. */}
        {selfReportedBand && (
          <p className="text-xs text-muted-foreground">
            {tIntake('self_reported_baseline', { band: tIntake(`band_${selfReportedBand}`) })}
          </p>
        )}

        {/* Monthly chart */}
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-sm font-medium">{t('monthly_title')}</div>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) {
                      return null;
                    }
                    const d: any = payload[0]?.payload;
                    return (
                      <div className="rounded-lg bg-white p-2 text-xs shadow-lg">
                        <div className="font-medium">{d.monthLabel}</div>
                        <div>
                          {t('mmd')}
                          :
                          {' '}
                          {d.mmd}
                        </div>
                        <div>
                          {t('med_days')}
                          :
                          {' '}
                          {d.meds}
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend />
                <Bar dataKey="meds" name={t('med_days')} fill="hsl(204, 94%, 68%)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="mmd" name={t('mmd')} stroke="hsl(346, 77%, 60%)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t('monthly_summary', { months: monthChartData.length })}
          </div>
        </div>

        {/* Daily calendar */}
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-sm font-medium">{t('daily_calendar_title')}</div>
          <div className="mb-3 text-xs text-muted-foreground">
            {t('heatmap_legend')}
          </div>

          <div className="space-y-6">
            {monthGrids.map(m => (
              <div key={m.month}>
                <div className="mb-2 text-sm font-medium">{m.label}</div>

                <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} className="px-1 text-center">{d}</div>
                  ))}
                </div>

                <div className="mt-1 grid grid-cols-7 gap-1">
                  {m.days.map((cell) => {
                    const v = dailyByDate.get(cell.date) ?? { dayType: null, tookMedication: false, medications: [] };
                    const cls = cell.inRange ? classForHeatCell(v) : 'bg-transparent';
                    const opacity = cell.inMonth ? '' : 'opacity-40';
                    const ring = cell.isToday ? 'ring-2 ring-primary' : '';
                    const dayNum = DateTime.fromISO(cell.date, { zone: effectiveTimezone }).day;
                    const medsText = v.medications.length > 0 ? v.medications.join(', ') : '';
                    const dayLabel = v.dayType === null
                      ? t('heat_missing')
                      : v.dayType === 'migraine_day'
                        ? t('heat_migraine_day')
                        : v.dayType === 'headache_day'
                          ? t('heat_headache_day')
                          : t('heat_headache_free');

                    return (
                      <Tooltip key={`${m.month}-${cell.date}`}>
                        <TooltipTrigger asChild>
                          <div
                            className={`relative flex size-8 items-center justify-center rounded-md border text-[11px] ${cls} ${opacity} ${ring}`}
                            aria-label={`${cell.date}: ${dayLabel}, ${v.tookMedication ? t('heat_med') : t('heat_no_med')}`}
                          >
                            <span className="font-medium text-foreground">{dayNum}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            <div className="font-medium">{cell.date}</div>
                            <div>
                              {dayLabel}
                              {', '}
                              {v.tookMedication ? t('heat_med') : t('heat_no_med')}
                            </div>
                            {medsText && (
                              <div className="mt-1">
                                <span className="font-medium">{t('medications_label')}</span>
                                {' '}
                                {medsText}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {t('heatmap_summary', {
              from: effectiveFromTo.from,
              to: effectiveFromTo.to,
              migraineDays: summary?.totals.mmdMin ?? 0,
              medDays: summary?.totals.acuteMedicationDays ?? 0,
            })}
          </div>
        </div>

        {/* Baseline settings */}
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 text-sm font-medium">{t('baseline_title')}</div>
          <div className="text-xs text-muted-foreground">
            {t('baseline_description')}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={baselineFrom}
              onChange={e => setBaselineFrom(e.target.value)}
              className="w-36"
              aria-label={t('baseline_from')}
            />
            <Input
              type="date"
              value={baselineTo}
              onChange={e => setBaselineTo(e.target.value)}
              className="w-36"
              aria-label={t('baseline_to')}
            />
            <Button type="button" onClick={saveBaseline} disabled={savingBaseline}>
              {savingBaseline ? t('saving') : t('save_baseline')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBaselineFrom('');
                setBaselineTo('');
              }}
            >
              {t('clear')}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
