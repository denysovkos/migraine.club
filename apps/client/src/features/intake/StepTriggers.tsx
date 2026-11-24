'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BUILT_IN_FACTOR_GROUPS } from '@/services/factors/factorCatalog';
import { cn } from '@/utils/Helpers';

type Props = {
  keys: string[];
  custom: string[];
  onChange: (next: { keys: string[]; custom: string[] }) => void;
};

export function StepTriggers({ keys, custom, onChange }: Props) {
  const t = useTranslations('Intake');
  const tf = useTranslations('Factors');
  const [draft, setDraft] = useState('');

  const triggers = BUILT_IN_FACTOR_GROUPS.find(g => g.type === 'trigger')?.items ?? [];

  const toggle = (key: string) => {
    onChange({
      keys: keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key],
      custom,
    });
  };

  const addCustom = () => {
    const label = draft.trim();
    if (!label || custom.includes(label) || custom.length >= 10) {
      return;
    }
    onChange({ keys, custom: [...custom, label] });
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('step_triggers_title')}</h1>
      <div className="flex flex-wrap gap-2">
        {triggers.map((f) => {
          const isSelected = keys.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggle(f.key)}
              aria-pressed={isSelected}
              className={cn(
                'min-h-[44px] rounded-full border px-4',
                isSelected ? 'border-primary bg-primary/10' : 'border-border',
              )}
            >
              {tf(f.translationKey)}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={t('custom_trigger_placeholder')}
          className="min-h-[44px] flex-1 rounded-lg border border-border px-3"
          maxLength={64}
        />
        <button type="button" onClick={addCustom} className="min-h-[44px] rounded-lg border px-4">
          {t('add')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {custom.map(label => (
          <span key={label} className="rounded-full bg-muted px-3 py-1 text-sm">{label}</span>
        ))}
      </div>
    </div>
  );
}
