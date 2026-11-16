'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/utils/Helpers';

const BANDS = ['lt1', '1_3', '4_7', '8_14', '15_plus'] as const;

type FrequencyBand = (typeof BANDS)[number];

type Props = {
  value: FrequencyBand | null;
  onChange: (band: FrequencyBand) => void;
};

export function StepFrequency({ value, onChange }: Props) {
  const t = useTranslations('Intake');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('step_frequency_title')}</h1>
      <div className="flex flex-col gap-2">
        {BANDS.map((band) => {
          const isSelected = value === band;
          return (
            <button
              key={band}
              type="button"
              onClick={() => onChange(band)}
              aria-pressed={isSelected}
              className={cn(
                'min-h-[44px] rounded-lg border px-4 py-3 text-left',
                isSelected ? 'border-primary bg-primary/10' : 'border-border',
              )}
            >
              {t(`band_${band}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
