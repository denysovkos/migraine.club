'use client';

import type { PreventivePlanListItem } from '@/features/preventives/preventivesApi';
import type { PreventivePlanKindType, PreventiveSchedulePayload } from '@/types/Preventives';
import { Bell, Check, ChevronRight, Plus, Search } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createPreventivePlan,
  listPreventivePlans,
} from '@/features/preventives/preventivesApi';
import { ReminderTimesField } from '@/features/preventives/ReminderTimesField';
import { showSnackbar } from '@/features/snackbar';
import {
  PreventivePlanKind,
  PreventiveScheduleType,
} from '@/types/Preventives';
import { trackEvent } from '@/utils/analytics';
import { cn } from '@/utils/Helpers';

type MedSearchResult
  = | {
    kind: 'user';
    userMedicationId: string;
    catalogMedicationId: string | null;
    label: string;
  }
  | {
    kind: 'catalog';
    catalogMedicationId: string;
    label: string;
  };

const KIND_OPTIONS: Array<{ id: PreventivePlanKindType; label: string }> = [
  { id: PreventivePlanKind.ORAL, label: 'Oral' },
  { id: PreventivePlanKind.INJECTION, label: 'Injection' },
  { id: PreventivePlanKind.INFUSION, label: 'Infusion' },
  { id: PreventivePlanKind.DEVICE, label: 'Device' },
  { id: PreventivePlanKind.SUPPLEMENT, label: 'Supplement' },
  { id: PreventivePlanKind.OTHER, label: 'Other' },
];

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 7, label: 'Sun' },
];

async function fetchMedicationSearch(q: string): Promise<MedSearchResult[]> {
  const res = await fetch(`/api/medications/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  if (!res.ok) {
    return [];
  }
  const data = await res.json().catch(() => ({ results: [] }));
  return (data.results ?? []) as MedSearchResult[];
}

function statusLabel(status: PreventivePlanListItem['status']): string {
  if (status === 'paused') {
    return 'Paused';
  }
  if (status === 'stopped') {
    return 'Stopped';
  }
  return 'Active';
}

function schedulePayloadForPreset(scheduleType: string): PreventiveSchedulePayload {
  if (scheduleType === PreventiveScheduleType.EVERY_N_WEEKS) {
    return { n: 4 };
  }
  return null;
}

export function PreventiveTreatmentsPage() {
  const t = useTranslations('Preventives');
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PreventivePlanListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [step, setStep] = useState(1);

  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MedSearchResult[]>([]);
  const [selectedMedName, setSelectedMedName] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [kind, setKind] = useState<PreventivePlanKindType>(PreventivePlanKind.ORAL);

  const [scheduleType, setScheduleType] = useState<string>(PreventiveScheduleType.DAILY);
  const [schedulePayload, setSchedulePayload] = useState<PreventiveSchedulePayload>(null);
  const [showMoreSchedules, setShowMoreSchedules] = useState(false);

  const [customWeekdays, setCustomWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [everyNDays, setEveryNDays] = useState(2);
  const [everyNWeeks, setEveryNWeeks] = useState(4);
  const [specificDates, setSpecificDates] = useState<string[]>([]);
  const [nextSpecificDate, setNextSpecificDate] = useState('');

  const [startDate, setStartDate] = useState(DateTime.now().toISODate()!);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);
  const [doseOpen, setDoseOpen] = useState(false);
  const [doseText, setDoseText] = useState('');
  const [saving, setSaving] = useState(false);

  const addSearchRef = useRef<HTMLInputElement | null>(null);

  const duplicateWarning = useMemo(() => plans.some(p => p.isDuplicateName), [plans]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPreventivePlans();
      setPlans(list);
    } catch (e: any) {
      setError(e?.message ?? t('error_generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!addOpen) {
      return;
    }
    window.requestAnimationFrame(() => addSearchRef.current?.focus());
  }, [addOpen]);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const tId = window.setTimeout(async () => {
      const res = await fetchMedicationSearch(q);
      setResults(res);
      setSearching(false);
    }, 150);
    return () => window.clearTimeout(tId);
  }, [search]);

  function resetAddFlow() {
    setStep(1);
    setSearch('');
    setResults([]);
    setSelectedMedName('');
    setSelectedCatalogId(null);
    setKind(PreventivePlanKind.ORAL);
    setScheduleType(PreventiveScheduleType.DAILY);
    setSchedulePayload(null);
    setShowMoreSchedules(false);
    setCustomWeekdays([1, 2, 3, 4, 5]);
    setEveryNDays(2);
    setEveryNWeeks(4);
    setSpecificDates([]);
    setNextSpecificDate('');
    setStartDate(DateTime.now().toISODate()!);
    setDoseOpen(false);
    setDoseText('');
    setRemindersEnabled(false);
    setReminderTimes([]);
  }

  async function savePlan() {
    if (!selectedMedName.trim()) {
      showSnackbar({ message: t('missing_name') });
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

      const created = await createPreventivePlan({
        name: selectedMedName.trim(),
        catalogMedicationId: selectedCatalogId,
        kind,
        scheduleType: scheduleType as any,
        schedulePayload: payload ?? null,
        startDate,
        doseText: doseText.trim() ? doseText.trim() : null,
        remindersEnabled,
        reminderTimes,
      });

      trackEvent('plan_created', { kind, scheduleType, remindersEnabled });
      showSnackbar({ message: t('created') });
      setAddOpen(false);
      resetAddFlow();
      await refresh();
      router.push(`/dashboard/settings/treatments/${created.id}`);
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    } finally {
      setSaving(false);
    }
  }

  const presetSchedule = (type: string) => {
    setScheduleType(type);
    setSchedulePayload(schedulePayloadForPreset(type));
  };

  const planList = (
    <div className="space-y-3">
      {plans.map(p => (
        <Link
          key={p.id}
          href={`/dashboard/settings/treatments/${p.id}`}
          className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm hover:bg-muted/20"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold">{p.name}</div>
              {p.isDuplicateName && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {t('duplicate_badge')}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{p.scheduleLabel}</div>
            {p.remindersEnabled && p.reminderTimes.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Bell className="size-3" />
                {p.reminderTimes.join(', ')}
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">{t('status_label', { status: statusLabel(p.status) })}</div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{t('treatments_title')}</div>
          <div className="mt-1 text-sm text-muted-foreground">{t('treatments_subtitle')}</div>
        </div>
        <Button type="button" className="min-h-11" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 size-4" />
          {t('add_cta')}
        </Button>
      </div>

      {duplicateWarning && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {t('duplicate_warning')}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl bg-destructive/15 p-3 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && plans.length === 0 && (
        <div className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{t('empty_title')}</div>
          <div className="mt-1">{t('empty_body')}</div>
        </div>
      )}

      {!loading && !error && plans.length > 0 && planList}

      <BottomSheet
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetAddFlow();
          }
          setAddOpen(open);
        }}
        title={t('add_title')}
      >
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">{t('step_label', { step, total: 3 })}</div>

          {step === 1 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={addSearchRef}
                  className="h-11 pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('search_placeholder')}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {searching ? t('searching') : t('search_hint')}
              </div>
              <div className="space-y-2">
                {results.map(r => (
                  <button
                    key={r.kind === 'user' ? `u:${r.userMedicationId}` : `c:${r.catalogMedicationId}`}
                    type="button"
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted',
                      selectedMedName === r.label && 'border-primary',
                    )}
                    onClick={() => {
                      setSelectedMedName(r.label);
                      setSelectedCatalogId(r.kind === 'user' ? r.catalogMedicationId : r.catalogMedicationId);
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">{r.label}</span>
                    {selectedMedName === r.label && <Check className="size-4 text-emerald-600" />}
                  </button>
                ))}

                {search.trim() && (
                  <button
                    type="button"
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-dashed bg-background px-3 text-left text-sm hover:bg-muted',
                      selectedMedName === search.trim() && 'border-primary',
                    )}
                    onClick={() => {
                      setSelectedMedName(search.trim());
                      setSelectedCatalogId(null);
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {t('custom_add', { name: search.trim() })}
                    </span>
                    {selectedMedName === search.trim() && <Check className="size-4 text-emerald-600" />}
                  </button>
                )}
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">{t('kind_label')}</div>
                <div className="flex flex-wrap gap-2">
                  {KIND_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={cn(
                        'min-h-11 rounded-full border px-3 text-sm',
                        kind === opt.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                      )}
                      onClick={() => setKind(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                className="h-12 w-full"
                onClick={() => setStep(2)}
                disabled={!selectedMedName}
              >
                {t('next')}
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={cn(
                    'min-h-11 rounded-xl border px-3 text-sm font-medium',
                    scheduleType === PreventiveScheduleType.DAILY && 'border-primary bg-primary text-primary-foreground',
                  )}
                  onClick={() => presetSchedule(PreventiveScheduleType.DAILY)}
                >
                  {t('schedule_daily')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'min-h-11 rounded-xl border px-3 text-sm font-medium',
                    scheduleType === PreventiveScheduleType.WEEKDAYS && 'border-primary bg-primary text-primary-foreground',
                  )}
                  onClick={() => presetSchedule(PreventiveScheduleType.WEEKDAYS)}
                >
                  {t('schedule_weekdays')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'min-h-11 rounded-xl border px-3 text-sm font-medium',
                    scheduleType === PreventiveScheduleType.EVERY_N_WEEKS && 'border-primary bg-primary text-primary-foreground',
                  )}
                  onClick={() => {
                    setEveryNWeeks(4);
                    presetSchedule(PreventiveScheduleType.EVERY_N_WEEKS);
                  }}
                >
                  {t('schedule_every_four_weeks')}
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-xl border px-3 text-sm font-medium"
                  onClick={() => setShowMoreSchedules(s => !s)}
                >
                  {showMoreSchedules ? t('schedule_less') : t('schedule_more')}
                </button>
              </div>

              {showMoreSchedules && (
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
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setStep(1)}>
                  {t('back')}
                </Button>
                <Button type="button" className="h-11 w-full" onClick={() => setStep(3)}>
                  {t('next')}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-sm font-medium">{t('start_date_label')}</div>
                <Input type="date" className="h-11" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>

              <button
                type="button"
                className="text-sm font-medium text-primary"
                onClick={() => setDoseOpen(v => !v)}
              >
                {doseOpen ? t('dose_hide') : t('dose_add')}
              </button>
              {doseOpen && (
                <Input
                  className="h-11"
                  value={doseText}
                  onChange={e => setDoseText(e.target.value)}
                  placeholder={t('dose_placeholder')}
                />
              )}

              <ReminderTimesField
                enabled={remindersEnabled}
                onEnabledChange={setRemindersEnabled}
                times={reminderTimes}
                onTimesChange={setReminderTimes}
              />

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setStep(2)}>
                  {t('back')}
                </Button>
                <Button type="button" className="h-11 w-full" onClick={savePlan} disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
