'use client';

import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showSnackbar } from '@/features/snackbar';
import { trackEvent } from '@/utils/analytics';

type WindowDays = 60 | 90 | 180;

type ApiResponse
  = | { state: 'disabled'; message?: string }
    | { state: 'consent_required'; message?: string }
    | { state: 'ready'; windowDays: number; methodVersion: string; payload: any; computedAt: string; status?: string };

type InsightCard = {
  id: string;
  factorId: string;
  factorName: string;
  factorType: 'trigger' | 'protector' | 'symptom';
  window: '0_12h' | '12_24h' | '24_48h';
  bucket: 'likely_increases' | 'likely_decreases' | 'no_clear_association';
  direction: 'increase' | 'decrease' | 'no_clear';
  caseRate: number;
  controlRate: number;
  riskDiff: number;
  riskDiffCi: { low: number; high: number };
  pValue: number;
  qValue: number;
  confidence: 'low' | 'medium' | 'high';
  possibleEarlySign: boolean;
  counts: {
    setsUsed: number;
    controlsPerSetAvg: number;
    caseExposed: number;
    caseTotal: number;
    controlExposed: number;
    controlTotal: number;
  };
};

type InsightPayload = {
  status: 'ready' | 'insufficient_data' | 'no_strong_signals';
  computedAt: string;
  dataReadiness: {
    diaryDaysRecorded: number;
    diaryDaysTotal: number;
    diaryCoveragePct: number;
    attackStarts: number;
    lastComputedAt: string;
    missing: string[];
  };
  highlights: InsightCard[];
  buckets: Array<{ id: string; title: string; items: InsightCard[] }>;
  trends: { weeklyAttackStarts: Array<{ weekStart: string; attackStarts: number }> };
  inputStats: {
    windowDays: number;
    caseMomentsUsed: number;
    diaryDaysObserved: number;
    factorsTested: number;
    exclusions: { episodesOutsideWindow: number; factorEventsDuringAttack: number; candidateControlsRejected: number };
  };
};

type TestPlan = {
  id: string;
  factorId: string;
  factorName: string;
  factorType: 'trigger' | 'protector' | 'symptom';
  direction: 'reduce' | 'increase';
  startDate: string;
  endDate: string;
  durationDays: number;
  status: 'active' | 'completed' | 'cancelled';
  notes: string;
  reminderEnabled: boolean;
  comparison: {
    before: { attackStarts: number; attackStartsPerWeek: number; diaryCoveragePct: number };
    during: { attackStarts: number; attackStartsPerWeek: number; diaryCoveragePct: number };
  };
};

type CycleInsights = {
  enabled: boolean;
  hasEnoughData: boolean;
  totalAttacks: number;
  attacksInWindow: number;
  attacksOutOfWindow: number;
  inWindowPct: number | null;
  rangeStart: number;
  rangeEnd: number;
  histogram: Array<{ relativeDay: number; count: number }>;
  bleedingStartCount: number;
};

function fmtPct(x: number): string {
  if (!Number.isFinite(x)) {
    return '—';
  }
  return `${(x * 100).toFixed(0)}%`;
}

function windowLabel(w: InsightCard['window'], t: ReturnType<typeof useTranslations<'Insights'>>): string {
  if (w === '0_12h') {
    return t('window_0_12h');
  }
  if (w === '12_24h') {
    return t('window_12_24h');
  }
  return t('window_24_48h');
}

function confidenceLabel(c: InsightCard['confidence'], t: ReturnType<typeof useTranslations<'Insights'>>): string {
  if (c === 'high') {
    return t('confidence_high');
  }
  if (c === 'medium') {
    return t('confidence_medium');
  }
  return t('confidence_low');
}

export function InsightsView() {
  const t = useTranslations('Insights');
  const [windowDays, setWindowDays] = useState<WindowDays>(90);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'disabled' | 'consent_required' | 'error'>('idle');
  const [payload, setPayload] = useState<InsightPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logName, setLogName] = useState('');
  const [logType, setLogType] = useState<'trigger' | 'protector' | 'symptom'>('trigger');
  const [logging, setLogging] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [importantIds, setImportantIds] = useState<Set<string>>(new Set());
  const [detailCard, setDetailCard] = useState<InsightCard | null>(null);
  const [planCard, setPlanCard] = useState<InsightCard | null>(null);
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [planDirection, setPlanDirection] = useState<'reduce' | 'increase'>('reduce');
  const [planDuration, setPlanDuration] = useState(14);
  const [planNotes, setPlanNotes] = useState('');
  const [planReminder, setPlanReminder] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [planUpdating, setPlanUpdating] = useState<string | null>(null);
  const [cycleInsights, setCycleInsights] = useState<CycleInsights | null>(null);

  const load = async () => {
    setState('loading');
    setError(null);
    try {
      const res = await fetch(`/api/insights?windowDays=${windowDays}`, { cache: 'no-store' });
      const data: ApiResponse = await res.json();

      if (data.state === 'disabled') {
        setState('disabled');
        setPayload(null);
        return;
      }
      if (data.state === 'consent_required') {
        setState('consent_required');
        setPayload(null);
        return;
      }
      if (data.state === 'ready') {
        setState('ready');
        setPayload(data.payload as InsightPayload);
        const cardCount = (data.payload?.buckets ?? []).reduce((sum: number, b: any) => sum + (b.items?.length ?? 0), 0);
        trackEvent('insights_cards_shown_count', { count: cardCount, windowDays });
        return;
      }

      setState('error');
      setError('Unexpected response');
    } catch (e: any) {
      setState('error');
      setError(e?.message || 'Failed to load insights');
    }
  };

  const loadPlans = async () => {
    try {
      const res = await fetch('/api/insights/test-plans', { cache: 'no-store' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      setPlans(Array.isArray(data?.plans) ? data.plans : []);
    } catch {
      setPlans([]);
    }
  };

  const loadCycleInsights = async () => {
    try {
      const data = await fetch('/api/cycle/insights', { cache: 'no-store' }).then(res => res.ok ? res.json() : null);
      setCycleInsights(data as CycleInsights | null);
    } catch {
      setCycleInsights(null);
    }
  };

  useEffect(() => {
    void load();
    void loadPlans();
    void loadCycleInsights();
    // eslint-disable-next-line react/exhaustive-deps
  }, [windowDays]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const hidden = window.localStorage.getItem('insights_hidden_v1');
    const important = window.localStorage.getItem('insights_important_v1');
    setHiddenIds(new Set(hidden ? JSON.parse(hidden) : []));
    setImportantIds(new Set(important ? JSON.parse(important) : []));
  }, []);

  useEffect(() => {
    if (!planCard) {
      return;
    }
    setPlanDirection('reduce');
    setPlanDuration(14);
    setPlanNotes('');
    setPlanReminder(true);
  }, [planCard]);

  const visibleBuckets = useMemo(() => {
    if (!payload) {
      return [];
    }
    return payload.buckets.map(b => ({
      ...b,
      items: (b.items ?? []).filter(item => !hiddenIds.has(item.id)),
    }));
  }, [payload, hiddenIds]);

  const highlights = useMemo(() => {
    if (!payload) {
      return [];
    }
    return (payload.highlights ?? []).filter(item => !hiddenIds.has(item.id));
  }, [payload, hiddenIds]);

  const readiness = payload?.dataReadiness ?? null;
  const weeklyTrend = payload?.trends?.weeklyAttackStarts ?? [];
  const sampleDays = readiness?.diaryDaysRecorded ?? 0;

  const bucketLabel = (id: string) => {
    if (id === 'likely_increases') {
      return t('bucket_likely_increases');
    }
    if (id === 'likely_decreases') {
      return t('bucket_likely_decreases');
    }
    return t('bucket_no_clear_association');
  };

  const savePlan = async () => {
    if (!planCard) {
      return;
    }
    setPlanSaving(true);
    try {
      const res = await fetch('/api/insights/test-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factorId: planCard.factorId,
          direction: planDirection,
          startDate: DateTime.now().toISODate(),
          durationDays: planDuration,
          notes: planNotes.trim() || undefined,
          reminderEnabled: planReminder,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || t('test_mode_error'));
      }
      showSnackbar({ message: t('test_mode_started') });
      trackEvent('test_mode_started', { factorId: planCard.factorId, durationDays: planDuration });
      setPlanCard(null);
      setPlanNotes('');
      await loadPlans();
    } catch (e: any) {
      showSnackbar({ message: e?.message || t('test_mode_error') });
    } finally {
      setPlanSaving(false);
    }
  };

  const completePlan = async (planId: string) => {
    setPlanUpdating(planId);
    try {
      const res = await fetch(`/api/insights/test-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || t('test_mode_error'));
      }
      trackEvent('test_mode_completed', { planId });
      await loadPlans();
    } catch (e: any) {
      showSnackbar({ message: e?.message || t('test_mode_error') });
    } finally {
      setPlanUpdating(null);
    }
  };

  const toggleHidden = (id: string) => {
    const next = new Set(hiddenIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setHiddenIds(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('insights_hidden_v1', JSON.stringify([...next]));
    }
  };

  const toggleImportant = (id: string) => {
    const next = new Set(importantIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setImportantIds(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('insights_important_v1', JSON.stringify([...next]));
    }
  };

  return (
    <div className="max-w-full space-y-4">
      <div className="flex max-w-full flex-col gap-3 rounded-lg border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium">{t('controls_title')}</div>
          <div className="text-xs text-muted-foreground">
            {t('controls_subtitle')}
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Button variant="outline" asChild className="h-9">
            <Link href="/dashboard/reports/clinician">Export for doctor</Link>
          </Button>
          <label className="text-xs text-muted-foreground">{t('window_label')}</label>
          <select
            className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
            value={windowDays}
            onChange={e => setWindowDays(Number(e.target.value) as WindowDays)}
          >
            <option value={60}>60</option>
            <option value={90}>90</option>
            <option value={180}>180</option>
          </select>
          <span className="text-xs text-muted-foreground">{t('days')}</span>
          <Button
            variant="outline"
            className="h-9"
            onClick={async () => {
              try {
                const res = await fetch('/api/insights/recompute', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ windowDays }),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  throw new Error(data?.error || 'Failed');
                }
                showSnackbar({ message: t('refresh_started') });
                await load();
              } catch (e: any) {
                showSnackbar({ message: e?.message || t('refresh_error') });
              }
            }}
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="max-w-full break-words rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
        {t('disclaimer')}
      </div>

      {state === 'disabled' && (
        <div className="max-w-full break-words rounded-lg border bg-card p-4 text-sm">
          <div className="font-medium">{t('disabled_title')}</div>
          <div className="mt-1 text-muted-foreground">{t('disabled_body')}</div>
        </div>
      )}

      {state === 'consent_required' && (
        <div className="max-w-full break-words rounded-lg border bg-card p-4 text-sm">
          <div className="font-medium">{t('consent_title')}</div>
          <div className="mt-1 text-muted-foreground">{t('consent_body')}</div>
        </div>
      )}

      {state === 'loading' && (
        <div className="max-w-full break-words rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t('loading')}
        </div>
      )}

      {state === 'error' && (
        <div className="max-w-full break-words rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? t('error')}
        </div>
      )}

      {state === 'ready' && readiness && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{t('readiness_title')}</div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_coverage')}</div>
              <div className="mt-0.5 font-medium">{fmtPct(readiness.diaryCoveragePct)}</div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_attacks')}</div>
              <div className="mt-0.5 font-medium">{readiness.attackStarts}</div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_computed')}</div>
              <div className="mt-0.5 font-medium">
                {DateTime.fromISO(readiness.lastComputedAt).toLocaleString(DateTime.DATE_MED)}
              </div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="text-muted-foreground">{t('readiness_missing')}</div>
              <div className="mt-0.5 font-medium">
                {readiness.missing.length > 0 ? readiness.missing.join(', ') : t('readiness_good')}
              </div>
            </div>
          </div>
        </div>
      )}

      {state === 'ready' && weeklyTrend.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{t('trend_title')}</div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs md:grid-cols-8">
            {weeklyTrend.slice(-8).map(w => (
              <div key={w.weekStart} className="rounded-md bg-muted p-2 text-center">
                <div className="text-muted-foreground">
                  {DateTime.fromISO(w.weekStart).toLocaleString({ month: 'short', day: 'numeric' })}
                </div>
                <div className="mt-1 font-medium">{w.attackStarts}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state === 'ready' && payload?.status === 'insufficient_data' && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="font-medium">{t('insufficient_title')}</div>
          <div className="mt-1 text-muted-foreground">{t('insufficient_body', { days: windowDays })}</div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('insufficient_tip_1')}</li>
            <li>{t('insufficient_tip_2')}</li>
            <li>{t('insufficient_tip_3')}</li>
          </ul>
        </div>
      )}

      {state === 'ready' && payload?.status !== 'insufficient_data' && (
        <>
          {cycleInsights?.enabled && cycleInsights.hasEnoughData && (
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm font-medium">{t('cycle_card_title')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('cycle_card_subtitle')}</div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-md bg-muted p-2 text-xs">
                  <div className="text-muted-foreground">{t('cycle_card_pct')}</div>
                  <div className="mt-0.5 text-base font-semibold">
                    {cycleInsights.inWindowPct === null ? '—' : `${Math.round(cycleInsights.inWindowPct * 100)}%`}
                  </div>
                </div>
                <div className="rounded-md bg-muted p-2 text-xs">
                  <div className="text-muted-foreground">{t('cycle_card_in_window')}</div>
                  <div className="mt-0.5 font-medium">{cycleInsights.attacksInWindow}</div>
                </div>
                <div className="rounded-md bg-muted p-2 text-xs">
                  <div className="text-muted-foreground">{t('cycle_card_out_window')}</div>
                  <div className="mt-0.5 font-medium">{cycleInsights.attacksOutOfWindow}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {t('cycle_card_window', { start: cycleInsights.rangeStart, end: cycleInsights.rangeEnd })}
              </div>
              <div className="mt-2 flex items-end gap-1 overflow-x-auto">
                {cycleInsights.histogram.map((row) => {
                  const max = Math.max(1, ...cycleInsights.histogram.map(x => x.count));
                  const height = Math.max(6, Math.round((row.count / max) * 28));
                  return (
                    <div key={`cycle-h-${row.relativeDay}`} className="flex min-w-6 flex-col items-center gap-1">
                      <div className="w-5 rounded-sm bg-violet-300/70 dark:bg-violet-700/60" style={{ height }} />
                      <div className="text-[10px] text-muted-foreground">{row.relativeDay}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">{t('cycle_card_disclaimer')}</div>
            </div>
          )}

          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">{t('standouts_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('standouts_subtitle')}</div>
            {highlights.length === 0
              ? (
                  <div className="mt-3 text-sm text-muted-foreground">{t('standouts_empty')}</div>
                )
              : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {highlights.map(c => (
                      <InsightCardCompact
                        key={c.id}
                        card={c}
                        sampleDays={sampleDays}
                        important={importantIds.has(c.id)}
                        onOpen={() => setDetailCard(c)}
                        onRunTest={() => setPlanCard(c)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
          </div>

          {payload?.status === 'no_strong_signals' && (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {t('no_strong_signals')}
            </div>
          )}

          <div className="space-y-3">
            {visibleBuckets.map(bucket => (
              <div key={bucket.id} className="rounded-lg border bg-card p-4">
                <div className="text-sm font-medium">{bucketLabel(bucket.id)}</div>
                {bucket.items.length === 0 && bucket.id === 'no_clear_association'
                  ? (
                      <div className="mt-2 text-sm text-muted-foreground">{t('no_clear_empty')}</div>
                    )
                  : bucket.items.length === 0
                    ? (
                        <div className="mt-2 text-sm text-muted-foreground">{t('bucket_empty')}</div>
                      )
                    : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {bucket.items.map(c => (
                            <InsightCardCompact
                              key={c.id}
                              card={c}
                              sampleDays={sampleDays}
                              important={importantIds.has(c.id)}
                              onOpen={() => setDetailCard(c)}
                              onRunTest={() => setPlanCard(c)}
                              t={t}
                            />
                          ))}
                        </div>
                      )}
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">{t('test_mode_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('test_mode_subtitle')}</div>
            {plans.length === 0
              ? (
                  <div className="mt-3 text-sm text-muted-foreground">{t('test_mode_empty')}</div>
                )
              : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {plans.map((p) => {
                      const change = p.comparison.before.attackStartsPerWeek - p.comparison.during.attackStartsPerWeek;
                      const isStrong = Math.abs(change) >= 1;
                      return (
                        <div key={p.id} className="rounded-lg border bg-muted p-3 text-sm">
                          <div className="font-medium">{p.factorName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {p.status === 'active'
                              ? t('test_mode_running', { days: p.durationDays })
                              : t('test_mode_completed')}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {t('test_mode_compare', {
                              before: p.comparison.before.attackStartsPerWeek.toFixed(1),
                              during: p.comparison.during.attackStartsPerWeek.toFixed(1),
                            })}
                          </div>
                          {!isStrong && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {t('test_mode_not_conclusive')}
                            </div>
                          )}
                          {p.status === 'active' && (
                            <div className="mt-2">
                              <Button
                                variant="outline"
                                className="min-h-11"
                                disabled={planUpdating === p.id}
                                onClick={() => completePlan(p.id)}
                              >
                                {t('test_mode_mark_complete')}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">{t('doctor_report_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('doctor_report_subtitle')}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[30, 60, 90].map(range => (
                <Button key={range} variant="outline" asChild className="min-h-11">
                  <Link href={`/dashboard/insights/report?window=${range}`}>
                    {t('doctor_report_cta', { days: range })}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">{t('log_title')}</div>
        <div className="mt-1 break-words text-xs text-muted-foreground">{t('log_subtitle')}</div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <Input
            value={logName}
            onChange={e => setLogName(e.target.value)}
            placeholder={t('log_placeholder')}
            className="h-11"
          />
          <select
            className="h-11 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm"
            value={logType}
            onChange={e => setLogType(e.target.value as any)}
          >
            <option value="trigger">{t('log_type_trigger')}</option>
            <option value="protector">{t('log_type_protector')}</option>
            <option value="symptom">{t('log_type_symptom')}</option>
          </select>
          <Button
            className="h-11"
            disabled={logging || logName.trim().length === 0}
            onClick={async () => {
              setLogging(true);
              try {
                const res = await fetch('/api/factors/log', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    displayName: logName.trim(),
                    type: logType,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data?.error || 'Failed to log');
                }
                setLogName('');
                showSnackbar({ message: t('log_success') });
                await load();
              } catch (e: any) {
                showSnackbar({ message: e?.message || t('log_error') });
              } finally {
                setLogging(false);
              }
            }}
          >
            {logging ? t('log_saving') : t('log_button')}
          </Button>
        </div>
      </div>

      <BottomSheet
        open={!!detailCard}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCard(null);
          }
        }}
        title={detailCard?.factorName ?? ''}
      >
        {detailCard && (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">{windowLabel(detailCard.window, t)}</div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{confidenceLabel(detailCard.confidence, t)}</Badge>
              {detailCard.possibleEarlySign && (
                <Badge variant="outline">{t('early_sign')}</Badge>
              )}
            </div>
            <div className="text-sm">{t('detail_explainer')}</div>

            <div className="rounded-lg bg-muted p-3 text-xs">
              <div className="font-medium">{t('detail_counts_title')}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  {t('detail_counts_case')}
                  :
                  {' '}
                  {detailCard.counts.caseExposed}
                  /
                  {detailCard.counts.caseTotal}
                </div>
                <div>
                  {t('detail_counts_control')}
                  :
                  {' '}
                  {detailCard.counts.controlExposed}
                  /
                  {detailCard.counts.controlTotal}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-muted p-3 text-xs">
              <div className="font-medium">{t('detail_effect_title')}</div>
              <div className="mt-2">
                {t('detail_effect_value', {
                  diff: fmtPct(detailCard.riskDiff),
                  low: fmtPct(detailCard.riskDiffCi.low),
                  high: fmtPct(detailCard.riskDiffCi.high),
                })}
              </div>
            </div>

            <div className="rounded-lg bg-muted p-3 text-xs">
              <div className="font-medium">{t('detail_exclusions_title')}</div>
              <div className="mt-2 text-muted-foreground">{t('detail_exclusions_body')}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => toggleHidden(detailCard.id)}>
                {hiddenIds.has(detailCard.id) ? t('detail_unhide') : t('detail_hide')}
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => toggleImportant(detailCard.id)}>
                {importantIds.has(detailCard.id) ? t('detail_unmark') : t('detail_mark')}
              </Button>
              <Button className="min-h-11" onClick={() => setPlanCard(detailCard)}>
                {t('run_test')}
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={!!planCard}
        onOpenChange={(open) => {
          if (!open) {
            setPlanCard(null);
          }
        }}
        title={t('test_mode_sheet_title')}
      >
        {planCard && (
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              {t('test_mode_sheet_subtitle', { factor: planCard.factorName })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('test_mode_disclaimer')}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button
                variant={planDirection === 'reduce' ? 'default' : 'outline'}
                className="min-h-11"
                onClick={() => setPlanDirection('reduce')}
              >
                {t('test_mode_reduce')}
              </Button>
              <Button
                variant={planDirection === 'increase' ? 'default' : 'outline'}
                className="min-h-11"
                onClick={() => setPlanDirection('increase')}
              >
                {t('test_mode_increase')}
              </Button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('test_mode_duration')}</label>
              <select
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
                value={planDuration}
                onChange={e => setPlanDuration(Number(e.target.value))}
              >
                {[7, 14, 21, 28].map(d => (
                  <option key={d} value={d}>{t('test_mode_days', { days: d })}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('test_mode_notes')}</label>
              <Input
                className="mt-1 h-11"
                value={planNotes}
                onChange={e => setPlanNotes(e.target.value)}
                placeholder={t('test_mode_notes_placeholder')}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={planReminder}
                onChange={e => setPlanReminder(e.target.checked)}
              />
              {t('test_mode_reminder')}
            </div>
            <Button className="min-h-11" disabled={planSaving} onClick={savePlan}>
              {planSaving ? t('test_mode_saving') : t('test_mode_start')}
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function InsightCardCompact(props: {
  card: InsightCard;
  sampleDays: number;
  important: boolean;
  onOpen: () => void;
  onRunTest: () => void;
  t: ReturnType<typeof useTranslations<'Insights'>>;
}) {
  const { card, t } = props;
  const directionLabel = card.direction === 'increase' ? t('direction_more_often') : t('direction_less_often');

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            {props.important ? '★ ' : ''}
            {card.factorName}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{windowLabel(card.window, t)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="secondary">{confidenceLabel(card.confidence, t)}</Badge>
          {card.possibleEarlySign ? <Badge variant="outline">{t('early_sign')}</Badge> : null}
        </div>
      </div>

      <div className="mt-3 text-sm leading-relaxed">
        {t('card_sentence', {
          factor: card.factorName,
          direction: directionLabel,
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted p-2">
          <div className="text-muted-foreground">{t('rate_case')}</div>
          <div className="mt-0.5 font-medium">{fmtPct(card.caseRate)}</div>
        </div>
        <div className="rounded-md bg-muted p-2">
          <div className="text-muted-foreground">{t('rate_control')}</div>
          <div className="mt-0.5 font-medium">{fmtPct(card.controlRate)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        {t('card_counts', {
          attacks: card.counts.caseTotal,
          days: props.sampleDays,
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={props.onOpen}>
          {t('details')}
        </Button>
        <Button className="min-h-11" onClick={props.onRunTest}>
          {t('run_test')}
        </Button>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {t('card_disclaimer')}
      </div>
    </div>
  );
}
