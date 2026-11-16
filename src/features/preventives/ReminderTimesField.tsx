'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';
import { MAX_REMINDER_TIMES, normalizeReminderTimes, REMINDER_TIME_OPTIONS } from '@/types/Preventives';

type Props = {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  times: string[];
  onTimesChange: (next: string[]) => void;
};

/**
 * Feature F42: the "when during the day" half of a preventive plan.
 *
 * The plan's schedule already decides which days a dose falls on; these are the
 * times of day on those days. Shared by the add wizard and the edit sheet so
 * both write the same shape.
 *
 * Picking a time commits it immediately. An earlier version held the typed time
 * in a draft that only landed when the user pressed an "Add" button, so a plan
 * saved right after choosing a time was stored with reminders on and no times —
 * which the cron skips, and no reminder ever arrived.
 */
export function ReminderTimesField(props: Props) {
  const t = useTranslations('Preventives');

  const atLimit = props.times.length >= MAX_REMINDER_TIMES;
  const available = REMINDER_TIME_OPTIONS.filter(time => !props.times.includes(time));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t('reminders_label')}</div>
          <div className="text-xs text-muted-foreground">{t('reminders_hint')}</div>
        </div>
        <Switch
          checked={props.enabled}
          onCheckedChange={props.onEnabledChange}
          aria-label={t('reminders_label')}
        />
      </div>

      {props.enabled && (
        <div className="space-y-2">
          <select
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            aria-label={t('reminder_add_time')}
            // Always renders the placeholder: the chosen option is committed to
            // the list on change, so the select itself never holds a value.
            value=""
            disabled={atLimit}
            onChange={(e) => {
              if (!e.target.value) {
                return;
              }
              props.onTimesChange(normalizeReminderTimes([...props.times, e.target.value]));
            }}
          >
            <option value="">{t('reminder_add_time')}</option>
            {available.map(time => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>

          {props.times.length === 0
            ? <div className="text-xs text-muted-foreground">{t('reminder_times_empty')}</div>
            : (
                <div className="flex flex-wrap gap-2">
                  {props.times.map(time => (
                    <button
                      key={time}
                      type="button"
                      className="flex min-h-8 items-center gap-1 rounded-full bg-muted px-3 text-xs"
                      onClick={() => props.onTimesChange(props.times.filter(v => v !== time))}
                      aria-label={t('reminder_remove_time', { time })}
                    >
                      {time}
                      <X className="size-3" />
                    </button>
                  ))}
                </div>
              )}

          <div className="text-xs text-muted-foreground">{t('reminder_resolution_hint')}</div>
        </div>
      )}
    </div>
  );
}
