'use client';

import type { CycleCalendarDay, CycleSettings } from './cycleApi';
import { Droplets } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { fetchTodayDiary } from '@/features/diary/diaryApi';

import { showSnackbar } from '@/features/snackbar';
import { fetchCycleCalendar, fetchCycleSettings, toggleBleedingDay, updateBleedingFlow } from './cycleApi';

export function CycleToggleChip() {
  const t = useTranslations('CycleSettings');
  const [settings, setSettings] = useState<CycleSettings | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [day, setDay] = useState<CycleCalendarDay | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [nextSettings, todayDiary] = await Promise.all([
      fetchCycleSettings(),
      fetchTodayDiary(),
    ]);
    setSettings(nextSettings);
    setToday(todayDiary.todayLocalDate);

    if (!nextSettings.enabled) {
      setDay(null);
      return;
    }

    const calendar = await fetchCycleCalendar({
      from: todayDiary.todayLocalDate,
      to: todayDiary.todayLocalDate,
    });
    const current = calendar.days.find(d => d.localDate === todayDiary.todayLocalDate) ?? null;
    setDay(current);
  };

  useEffect(() => {
    load().catch(() => {
      setSettings(null);
    });
  }, []);

  if (!settings?.enabled || !today) {
    return null;
  }

  const bleeding = !!day?.bleeding;

  return (
    <>
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex min-h-12 flex-1 items-center gap-3 rounded-xl bg-muted/40 px-3 text-left active:scale-[0.99]"
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true);
                const next = await toggleBleedingDay(today);
                setDay(next);
                showSnackbar({
                  message: next.bleeding ? t('snackbar_marked') : t('snackbar_cleared'),
                });
              } catch {
                showSnackbar({ message: t('save_error') });
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className={`flex size-9 items-center justify-center rounded-xl ${bleeding ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}>
              <Droplets className="size-4" />
            </div>
            <div>
              <div className="text-sm font-medium">{t('today_chip_title')}</div>
              <div className="text-xs text-muted-foreground">{bleeding ? t('today_chip_on') : t('today_chip_off')}</div>
            </div>
          </button>
          <Button variant="ghost" className="min-h-11 px-3 text-xs" onClick={() => setDetailsOpen(true)}>
            {t('details')}
          </Button>
        </div>
      </div>

      <BottomSheet open={detailsOpen} onOpenChange={setDetailsOpen} title={t('details')}>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">{t('flow_label')}</div>
          <div className="grid grid-cols-2 gap-2">
            {(['unspecified', 'light', 'medium', 'heavy'] as const).map(flow => (
              <Button
                key={flow}
                variant={day?.flow === flow ? 'default' : 'outline'}
                className="min-h-11"
                disabled={saving}
                onClick={async () => {
                  if (!today) {
                    return;
                  }
                  try {
                    setSaving(true);
                    const next = await updateBleedingFlow({ localDate: today, flow });
                    setDay(next);
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
          <Button asChild variant="outline" className="min-h-11 w-full">
            <Link href="/dashboard/diary">{t('view_calendar')}</Link>
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
