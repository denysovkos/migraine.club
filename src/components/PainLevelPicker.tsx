'use client';

import type { ComponentType } from 'react';
import type { PainLevel } from '@/utils/painLevel';
import { Angry, Annoyed, Check, Frown, Meh, Siren } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { cn } from '@/utils/Helpers';
import { painLevelDisplay } from '@/utils/painLevel';

type Size = 'md' | 'lg';

export type PainLevelPickerProps = {
  value: PainLevel | null;
  onChange: (newValue: PainLevel) => void;
  disabled?: boolean;
  size?: Size;
  className?: string;
};

const ICONS: Record<PainLevel, ComponentType<{ className?: string }>> = {
  1: Meh,
  2: Frown,
  3: Annoyed,
  4: Angry,
  5: Siren,
};

export function PainLevelPicker({
  value,
  onChange,
  disabled = false,
  size = 'lg',
  className,
}: PainLevelPickerProps) {
  const t = useTranslations('painLevel');
  const tileHeight = size === 'lg' ? 'min-h-14' : 'min-h-12';
  const iconSize = size === 'lg' ? 'size-6' : 'size-5';

  const renderTile = (level: PainLevel, className?: string) => {
    const Icon = ICONS[level];
    const isSelected = value === level;
    const label = t(`level_${level}` as any);
    const ariaLabel = t('aria_label', {
      level: painLevelDisplay(level),
      label,
    });

    return (
      <button
        key={level}
        type="button"
        disabled={disabled}
        onClick={() => onChange(level)}
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        title={label}
        className={cn(
          'relative flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border bg-card px-2 py-3 shadow-sm transition',
          'sm:flex-row sm:justify-between sm:gap-3 sm:px-3 sm:text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          'active:scale-[0.99]',
          tileHeight,
          className,
          disabled && 'pointer-events-none opacity-60',
          isSelected
            ? 'border-primary ring-2 ring-primary/15'
            : 'border-border hover:border-primary/50 hover:bg-muted/50',
        )}
      >
        <div className="flex min-w-0 flex-col items-center gap-1.5 sm:flex-row sm:gap-3">
          <span
            className={cn(
              'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background sm:size-10',
              isSelected ? 'border-primary/50' : 'border-border',
            )}
          >
            <Icon className={cn(iconSize, isSelected ? 'text-primary' : 'text-foreground')} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {painLevelDisplay(level)}
              </span>
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">{label}</span>
            </div>
          </div>
        </div>

        {/* Selected state: checkmark only on sm+ to save space on mobile */}
        <span
          className={cn(
            'hidden size-8 shrink-0 items-center justify-center rounded-full border sm:inline-flex',
            isSelected ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-transparent',
          )}
          aria-hidden="true"
        >
          <Check className="size-4" />
        </span>
      </button>
    );
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Mobile: 5 equal compact tiles in one row.
          sm+: 5 columns with full label + check. */}
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {renderTile(1)}
        {renderTile(2)}
        {renderTile(3)}
        {renderTile(4)}
        {renderTile(5)}
      </div>

      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
