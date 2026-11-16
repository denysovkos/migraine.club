'use client';

import type { IntakeAnswers } from '@/models/intake';

import { useTranslations } from 'next-intl';

import { cn } from '@/utils/Helpers';

type Habits = NonNullable<IntakeAnswers['habits']>;

type Props = {
  value: Habits;
  onChange: (next: Habits) => void;
};

const SLEEP = ['often', 'sometimes', 'rarely'] as const;
const TIMING = ['lt30', '30_120', 'gt120', 'varies'] as const;

export function StepHabits({ value, onChange }: Props) {
  const t = useTranslations('Intake');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('step_habits_title')}</h1>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted-foreground">{t('sleep_trouble_label')}</legend>
        <div className="flex flex-wrap gap-2">
          {SLEEP.map((option) => {
            const isSelected = value.sleepTrouble === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange({ ...value, sleepTrouble: option })}
                aria-pressed={isSelected}
                className={cn(
                  'min-h-[44px] rounded-full border px-4',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                {t(`sleep_${option}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('bed_label')}
          <input
            type="time"
            value={value.typicalBed ?? ''}
            onChange={e => onChange({ ...value, typicalBed: e.target.value || null })}
            className="min-h-[44px] rounded-lg border border-border px-3"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('wake_label')}
          <input
            type="time"
            value={value.typicalWake ?? ''}
            onChange={e => onChange({ ...value, typicalWake: e.target.value || null })}
            className="min-h-[44px] rounded-lg border border-border px-3"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted-foreground">{t('med_timing_label')}</legend>
        <div className="flex flex-col gap-2">
          {TIMING.map((option) => {
            const isSelected = value.medTiming === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange({ ...value, medTiming: option })}
                aria-pressed={isSelected}
                className={cn(
                  'min-h-[44px] rounded-lg border px-4 py-3 text-left',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                {t(`timing_${option}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
