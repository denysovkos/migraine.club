'use client';

import type { CycleCalendarDay } from './cycleApi';
import { ChevronLeft, ChevronRight, Droplets } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { showSnackbar } from '@/features/snackbar';

import { cn } from '@/utils/Helpers';
import { fetchCycleCalendar, fetchCycleSettings, toggleBleedingDay, updateBleedingFlow } from './cycleApi';

function buildMonthGrid(monthStart: DateTime): DateTime[] {
  const start = monthStart.startOf('month');
  const end = monthStart.endOf('month');
  const gridStart = start.minus({ days: start.weekday - 1 });
  const gridEnd = end.plus({ days: 7 - end.weekday });
  const out: DateTime[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    out.push(cur);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function CycleCalendarView() {
  const t = useTranslations('CycleSettings');
  const [timezone, setTimezone] = useState('UTC');
  const [monthStart, setMonthStart] = useState(DateTime.now().startOf('month'));
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [daysByDate, setDaysByDate] = useState<Map<string, CycleCalendarDay>>(new Map());
  const [migraineDays, setMigraineDays] = useState<Set<string>>(new Set());
  const [flowEditorDate, setFlowEditorDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const settings = await fetchCycleSettings();
    setEnabled(settings.enabled);
    if (!settings.enabled) {
      setLoading(false);
      return;
    }
    const from = monthStart.startOf('month').toISODate()!;
    const to = monthStart.endOf('month').toISODate()!;
    const calendar = await fetchCycleCalendar({ from, to });
    setTimezone(calendar.timezone);
    setDaysByDate(new Map(calendar.days.map(day => [day.localDate, day])));
    setMigraineDays(new Set(calendar.migraineDays));
    setLoading(false);
  }, [monthStart]);

  useEffect(() => {
    load().catch(() => {
      setLoading(false);
    });
  }, [load]);

  const monthGrid = useMemo(
    () => buildMonthGrid(monthStart.setZone(timezone)),
    [monthStart, timezone],
  );

  if (!enabled) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm">
        <div className="font-medium">{t('calendar_disabled_title')}</div>
        <div className="mt-1 text-muted-foreground">{t('calendar_disabled_body')}</div>
        <Button asChild className="mt-3 min-h-11">
          <Link href="/dashboard/settings/cycle">{t('go_to_settings')}</Link>
        </Button>
      </div>
    );
  }

  const activeDay = flowEditorDate ? daysByDate.get(flowEditorDate) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            className="min-h-12 min-w-12 px-3"
            onClick={() => setMonthStart(m => m.minus({ months: 1 }))}
            disabled={loading}
            aria-label={t('prev_month')}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div className="text-sm font-semibold">
            {monthStart.setZone(timezone).toLocaleString({ month: 'long', year: 'numeric' })}
          </div>
          <Button
            variant="outline"
            className="min-h-12 min-w-12 px-3"
            onClick={() => setMonthStart(m => m.plus({ months: 1 }))}
            disabled={loading}
            aria-label={t('next_month')}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-rose-500" />
            {t('legend_bleeding')}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-sky-500" />
            {t('legend_migraine')}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-3">
        <div className="grid grid-cols-7 gap-2 px-1 pb-2 text-center text-xs font-medium text-muted-foreground">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {monthGrid.map((day) => {
            const ymd = day.toISODate()!;
            const inMonth = day.month === monthStart.month;
            const bleedingDay = daysByDate.get(ymd);
            const bleeding = !!bleedingDay?.bleeding;
            const migraine = migraineDays.has(ymd);
            return (
              <button
                key={ymd}
                type="button"
                className={cn(
                  'relative flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-2 text-sm',
                  'active:scale-[0.98]',
                  !inMonth && 'opacity-40',
                  bleeding && 'bg-rose-50 dark:bg-rose-950/20',
                )}
                onClick={async () => {
                  try {
                    setSaving(true);
                    const next = await toggleBleedingDay(ymd);
                    setDaysByDate((prev) => {
                      const copy = new Map(prev);
                      copy.set(ymd, next);
                      return copy;
                    });
                  } catch {
                    showSnackbar({ message: t('save_error') });
                  } finally {
                    setSaving(false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setFlowEditorDate(ymd);
                }}
                onDoubleClick={() => setFlowEditorDate(ymd)}
                disabled={saving}
              >
                <div className="text-sm tabular-nums">{day.day}</div>
                <div className="mt-1 flex items-center gap-1">
                  {bleeding && <Droplets className="size-3 text-rose-600 dark:text-rose-300" />}
                  {migraine && <span className="inline-block size-1.5 rounded-full bg-sky-500" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <BottomSheet
        open={!!flowEditorDate}
        onOpenChange={open => !open && setFlowEditorDate(null)}
        title={flowEditorDate ?? t('flow_label')}
      >
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">{t('flow_label')}</div>
          <div className="grid grid-cols-2 gap-2">
            {(['unspecified', 'light', 'medium', 'heavy'] as const).map(flow => (
              <Button
                key={flow}
                variant={activeDay?.flow === flow ? 'default' : 'outline'}
                className="min-h-11"
                onClick={async () => {
                  if (!flowEditorDate) {
                    return;
                  }
                  try {
                    setSaving(true);
                    const next = await updateBleedingFlow({ localDate: flowEditorDate, flow });
                    setDaysByDate((prev) => {
                      const copy = new Map(prev);
                      copy.set(flowEditorDate, next);
                      return copy;
                    });
                    showSnackbar({ message: t('saved') });
                  } catch {
                    showSnackbar({ message: t('save_error') });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t(`flow_options.${flow}`)}
              </Button>
            ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
