'use client';

import type { PreventivePlanSummary } from '@/features/preventives/preventivesApi';
import type { PreventiveSchedulePayload, PreventiveSideEffectType, PreventiveStillTakingType, PreventiveStopReasonType } from '@/types/Preventives';
import { Check, Pause, Play, Share2, Square } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchPreventiveSummary,
  pausePreventivePlan,
  resumePreventivePlan,
  stopPreventivePlan,
  submitWeeklyCheckIn,
  updatePreventivePlan,
} from '@/features/preventives/preventivesApi';
import { ReminderTimesField } from '@/features/preventives/ReminderTimesField';
import { showSnackbar } from '@/features/snackbar';
import {
  PreventiveScheduleType,
  PreventiveSideEffect,
  PreventiveStillTaking,
  PreventiveStopReason,
} from '@/types/Preventives';
import { trackEvent } from '@/utils/analytics';
import { cn } from '@/utils/Helpers';

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 7, label: 'Sun' },
];

export function PreventivePlanDetailView(props: { planId: string }) {
  const t = useTranslations('Preventives');
  const router = useRouter();
  const [summary, setSummary] = useState<PreventivePlanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);

  const [scheduleType, setScheduleType] = useState<string>(PreventiveScheduleType.DAILY);
  const [schedulePayload, setSchedulePayload] = useState<PreventiveSchedulePayload>(null);
  const [startDate, setStartDate] = useState('');
  const [doseText, setDoseText] = useState('');
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);

  const [customWeekdays, setCustomWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [everyNDays, setEveryNDays] = useState(2);
  const [everyNWeeks, setEveryNWeeks] = useState(4);
  const [specificDates, setSpecificDates] = useState<string[]>([]);
  const [nextSpecificDate, setNextSpecificDate] = useState('');

  const [stopReason, setStopReason] = useState<PreventiveStopReasonType>(PreventiveStopReason.NOT_HELPING);
  const [stopNote, setStopNote] = useState('');
  const [sideEffects, setSideEffects] = useState<PreventiveSideEffectType>(PreventiveSideEffect.NONE);
  const [stillTaking, setStillTaking] = useState<PreventiveStillTakingType>(PreventiveStillTaking.YES);
  const [checkInNote, setCheckInNote] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPreventiveSummary(props.planId);
      setSummary(res);
      setScheduleType(res.plan.scheduleType);
      setSchedulePayload(res.plan.schedulePayload as PreventiveSchedulePayload);
      setStartDate(res.plan.startDate);
      setDoseText(res.plan.doseText ?? '');
      setRemindersEnabled(res.plan.remindersEnabled);
      setReminderTimes(res.plan.reminderTimes ?? []);
      if (Array.isArray(res.plan.schedulePayload)) {
        if (res.plan.scheduleType === PreventiveScheduleType.CUSTOM_WEEKDAYS) {
          setCustomWeekdays(res.plan.schedulePayload as number[]);
        }
        if (res.plan.scheduleType === PreventiveScheduleType.ON_SPECIFIC_DATES) {
          setSpecificDates(res.plan.schedulePayload as string[]);
        }
      }
      if (res.plan.schedulePayload && typeof res.plan.schedulePayload === 'object' && 'n' in res.plan.schedulePayload) {
        const n = (res.plan.schedulePayload as any).n;
        if (res.plan.scheduleType === PreventiveScheduleType.EVERY_N_DAYS) {
          setEveryNDays(Number(n) || 2);
        }
        if (res.plan.scheduleType === PreventiveScheduleType.EVERY_N_WEEKS) {
          setEveryNWeeks(Number(n) || 4);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? t('error_generic'));
    } finally {
      setLoading(false);
    }
  }, [props.planId, t]);

  useEffect(() => {
    refresh();
    trackEvent('opened_plan_details');
  }, [refresh]);

  const responderLabel = useMemo(() => {
    if (!summary?.evaluation) {
      return t('responder_not_enough');
    }
    if (summary.evaluation.responder50 === 'NOT_ENOUGH_DATA') {
      return t('responder_not_enough');
    }
    if (summary.evaluation.responder50 === 'YES') {
      return t('responder_yes');
    }
    if (summary.evaluation.responder50 === 'NO') {
      return t('responder_no');
    }
    return t('responder_na');
  }, [summary, t]);

  const percentChangeText = useMemo(() => {
    const val = summary?.evaluation?.percentChangeMmd ?? null;
    if (val === null || Number.isNaN(val)) {
      return t('na');
    }
    const pct = Math.round(val * 100);
    return pct > 0 ? `+${pct}%` : `${pct}%`;
  }, [summary, t]);

  const evaluationMissing = summary?.evaluation?.responder50 === 'NOT_ENOUGH_DATA'
    ? summary?.evaluation?.missingDaysNeeded ?? 0
    : 0;

  const adherencePct = (taken: number, missed: number) => {
    const total = taken + missed;
    if (total === 0) {
      return t('na');
    }
    return `${Math.round((taken / total) * 100)}%`;
  };

  async function onPauseResume() {
    if (!summary) {
      return;
    }
    try {
      if (summary.plan.status === 'paused') {
        await resumePreventivePlan(summary.plan.id);
        trackEvent('plan_resumed');
      } else {
        await pausePreventivePlan(summary.plan.id);
        trackEvent('plan_paused');
      }
      await refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    }
  }

  async function onStop() {
    if (!summary) {
      return;
    }
    setSaving(true);
    try {
      await stopPreventivePlan(summary.plan.id, { reason: stopReason, reasonNote: stopNote || null });
      trackEvent('plan_stopped', { reason: stopReason });
      setStopOpen(false);
      await refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEdit() {
    if (!summary) {
      return;
    }
    // Reminders on with no times saves a plan the cron silently skips.
    if (remindersEnabled && reminderTimes.length === 0) {
      showSnackbar({ message: t('reminder_times_required') });
      return;
    }
    setSaving(true);
    try {
      const payload = (() => {
        if (scheduleType === PreventiveScheduleType.CUSTOM_WEEKDAYS) {
          return customWeekdays;
        }
        if (scheduleType === PreventiveScheduleType.EVERY_N_DAYS) {
          return { n: everyNDays };
        }
        if (scheduleType === PreventiveScheduleType.EVERY_N_WEEKS) {
          return { n: everyNWeeks };
        }
        if (scheduleType === PreventiveScheduleType.ON_SPECIFIC_DATES) {
          return specificDates;
        }
        return schedulePayload;
      })();
      await updatePreventivePlan(summary.plan.id, {
        scheduleType: scheduleType as any,
        schedulePayload: payload ?? null,
        startDate,
        doseText: doseText.trim() ? doseText.trim() : null,
        remindersEnabled,
        reminderTimes,
      });
      setEditOpen(false);
      await refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    } finally {
      setSaving(false);
    }
  }

  async function onWeeklyCheckIn() {
    if (!summary) {
      return;
    }
    const weekStartLocalDate = DateTime.now()
      .setZone(summary.timezone)
      .startOf('week')
      .toISODate()!;
    setSaving(true);
    try {
      await submitWeeklyCheckIn(summary.plan.id, {
        weekStartLocalDate,
        sideEffects,
        stillTaking,
        note: checkInNote.trim() ? checkInNote.trim() : null,
      });
      setCheckInOpen(false);
      showSnackbar({ message: t('checkin_saved') });
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  if (error || !summary) {
    return (
      <div className="rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
        {error || t('error_generic')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{summary.plan.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {summary.plan.scheduleLabel}
              {' • '}
              {t('start_date_short', { date: summary.plan.startDate })}
            </div>
            {summary.plan.doseText && (
              <div className="mt-1 text-xs text-muted-foreground">{summary.plan.doseText}</div>
            )}
          </div>
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            {summary.plan.status}
          </span>
        </div>

        <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">
          <div className="font-medium">{t('effect_summary_title')}</div>
          {evaluationMissing > 0
            ? (
                <div className="mt-1 text-muted-foreground">
                  {t('not_enough_data', { days: evaluationMissing })}
                </div>
              )
            : (
                <div className="mt-1 text-muted-foreground">{t('effect_ready')}</div>
              )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm font-medium">{t('baseline_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.baseline?.from}
            {' '}
            –
            {summary.baseline?.to}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t('mmd')}</div>
              <div className="text-lg font-semibold">{summary.baseline?.mmd ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('mhd')}</div>
              <div className="text-lg font-semibold">{summary.baseline?.mhd ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('med_days')}</div>
              <div className="text-lg font-semibold">{summary.baseline?.acuteMedicationDays ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm font-medium">{t('on_treatment_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.evaluation?.from ?? summary.plan.startDate}
            {' – '}
            {summary.evaluation?.to ?? summary.plan.startDate}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t('mmd')}</div>
              <div className="text-lg font-semibold">{summary.evaluation?.mmd ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('mhd')}</div>
              <div className="text-lg font-semibold">{summary.evaluation?.mhd ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('med_days')}</div>
              <div className="text-lg font-semibold">{summary.evaluation?.acuteMedicationDays ?? 0}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t('percent_change', { value: percentChangeText })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{t('responder_title')}</div>
          <div className="text-sm text-muted-foreground">{responderLabel}</div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="text-sm font-medium">{t('adherence_title')}</div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">{t('last_7_days')}</div>
            <div className="mt-1 text-lg font-semibold">
              {adherencePct(summary.adherence.last7.taken, summary.adherence.last7.missed)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('coverage_pct', { pct: Math.round(summary.adherence.last7.coverage * 100) })}
            </div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">{t('last_28_days')}</div>
            <div className="mt-1 text-lg font-semibold">
              {adherencePct(summary.adherence.last28.taken, summary.adherence.last28.missed)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('coverage_pct', { pct: Math.round(summary.adherence.last28.coverage * 100) })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="text-sm font-medium">{t('timeline_title')}</div>
        <div className="mt-3 space-y-2 text-sm">
          {summary.timelineWeeks.map(week => (
            <div key={week.weekStart} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
              <div>
                <div className="text-xs text-muted-foreground">{week.weekStart}</div>
                <div className="text-sm">{t('migraine_days_short', { count: week.migraineDays })}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {week.adherence === null ? t('na') : t('adherence_pct', { pct: Math.round(week.adherence * 100) })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onPauseResume}>
          {summary.plan.status === 'paused'
            ? (
                <>
                  <Play className="mr-2 size-4" />
                  {t('resume')}
                </>
              )
            : (
                <>
                  <Pause className="mr-2 size-4" />
                  {t('pause')}
                </>
              )}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditOpen(true)}>
          {t('edit_schedule')}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setStopOpen(true)}>
          <Square className="mr-2 size-4" />
          {t('stop')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            trackEvent('export_doctor_summary_clicked', { planId: summary.plan.id });
            router.push('/dashboard/share');
          }}
        >
          <Share2 className="mr-2 size-4" />
          {t('export_doctor')}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setCheckInOpen(true)}>
          {t('weekly_checkin')}
        </Button>
      </div>

      <BottomSheet open={editOpen} onOpenChange={setEditOpen} title={t('edit_schedule')}>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">{t('schedule_type_label')}</div>
            <select
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value)}
            >
              <option value={PreventiveScheduleType.DAILY}>{t('schedule_daily')}</option>
              <option value={PreventiveScheduleType.WEEKDAYS}>{t('schedule_weekdays')}</option>
              <option value={PreventiveScheduleType.CUSTOM_WEEKDAYS}>{t('schedule_custom_weekdays')}</option>
              <option value={PreventiveScheduleType.EVERY_N_DAYS}>{t('schedule_every_n_days')}</option>
              <option value={PreventiveScheduleType.EVERY_N_WEEKS}>{t('schedule_every_n_weeks')}</option>
              <option value={PreventiveScheduleType.ON_SPECIFIC_DATES}>{t('schedule_specific_dates')}</option>
            </select>
          </div>

          {scheduleType === PreventiveScheduleType.CUSTOM_WEEKDAYS && (
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const selected = customWeekdays.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={cn(
                      'min-h-10 rounded-full border px-3 text-sm',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                    )}
                    onClick={() => {
                      setCustomWeekdays(prev => selected
                        ? prev.filter(v => v !== d.id)
                        : [...prev, d.id]);
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}

          {scheduleType === PreventiveScheduleType.EVERY_N_DAYS && (
            <div>
              <div className="mb-1 text-sm font-medium">{t('every_n_days_label')}</div>
              <Input
                type="number"
                className="h-11"
                min={1}
                value={everyNDays}
                onChange={e => setEveryNDays(Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}

          {scheduleType === PreventiveScheduleType.EVERY_N_WEEKS && (
            <div>
              <div className="mb-1 text-sm font-medium">{t('every_n_weeks_label')}</div>
              <Input
                type="number"
                className="h-11"
                min={1}
                value={everyNWeeks}
                onChange={e => setEveryNWeeks(Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}

          {scheduleType === PreventiveScheduleType.ON_SPECIFIC_DATES && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="h-11"
                  value={nextSpecificDate}
                  onChange={e => setNextSpecificDate(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!nextSpecificDate) {
                      return;
                    }
                    setSpecificDates(prev => [...new Set([...prev, nextSpecificDate])]);
                    setNextSpecificDate('');
                  }}
                >
                  {t('add_date')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {specificDates.map(d => (
                  <span key={d} className="rounded-full bg-muted px-2 py-1">{d}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-sm font-medium">{t('start_date_label')}</div>
            <Input type="date" className="h-11" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">{t('dose_label')}</div>
            <Input className="h-11" value={doseText} onChange={e => setDoseText(e.target.value)} />
          </div>

          <ReminderTimesField
            enabled={remindersEnabled}
            onEnabledChange={setRemindersEnabled}
            times={reminderTimes}
            onTimesChange={setReminderTimes}
          />

          <Button type="button" className="h-12 w-full" onClick={onSaveEdit} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={stopOpen} onOpenChange={setStopOpen} title={t('stop_title')}>
        <div className="space-y-3">
          <div className="space-y-2">
            {Object.values(PreventiveStopReason).map(reason => (
              <button
                key={reason}
                type="button"
                className={cn(
                  'flex min-h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm',
                  stopReason === reason && 'border-primary',
                )}
                onClick={() => setStopReason(reason)}
              >
                <span>{t(`stop_reason_${reason}`)}</span>
                {stopReason === reason && <Check className="size-4 text-emerald-600" />}
              </button>
            ))}
          </div>
          <Input
            className="h-11"
            placeholder={t('stop_note_placeholder')}
            value={stopNote}
            onChange={e => setStopNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setStopOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" className="h-11 w-full" onClick={onStop} disabled={saving}>
              {saving ? t('saving') : t('confirm_stop')}
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={checkInOpen} onOpenChange={setCheckInOpen} title={t('weekly_checkin')}>
        <div className="space-y-3">
          <div>
            <div className="mb-2 text-sm font-medium">{t('checkin_side_effects')}</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(PreventiveSideEffect).map(opt => (
                <button
                  key={opt}
                  type="button"
                  className={cn(
                    'min-h-11 rounded-md border px-3 text-sm',
                    sideEffects === opt ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                  )}
                  onClick={() => setSideEffects(opt)}
                >
                  {t(`side_effect_${opt}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">{t('checkin_still_taking')}</div>
            <div className="grid grid-cols-3 gap-2">
              {Object.values(PreventiveStillTaking).map(opt => (
                <button
                  key={opt}
                  type="button"
                  className={cn(
                    'min-h-11 rounded-md border px-3 text-sm',
                    stillTaking === opt ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                  )}
                  onClick={() => setStillTaking(opt)}
                >
                  {t(`still_taking_${opt}`)}
                </button>
              ))}
            </div>
          </div>
          <Input
            className="h-11"
            placeholder={t('checkin_note_placeholder')}
            value={checkInNote}
            onChange={e => setCheckInNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setCheckInOpen(false)}>
              {t('skip')}
            </Button>
            <Button type="button" className="h-11 w-full" onClick={onWeeklyCheckIn} disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
