'use client';

import type { ComponentType } from 'react';
import type { PainLevel } from '@/utils/painLevel';
import { Angry, Annoyed, Frown, Meh, Siren } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/utils/Helpers';
import { normalizeToPainLevel, painLevelDisplay } from '@/utils/painLevel';

const ICONS: Record<PainLevel, ComponentType<{ className?: string }>> = {
  1: Meh,
  2: Frown,
  3: Annoyed,
  4: Angry,
  5: Siren,
};

export function PainLevelBadge({
  value,
  className,
}: {
  /** Accepts legacy 0–10 values; will be normalized to 1–5 */
  value: number | null | undefined;
  className?: string;
}) {
  const t = useTranslations('painLevel');
  const level = normalizeToPainLevel(value);

  if (!level) {
    return (
      <Badge variant="secondary" className={cn('tabular-nums', className)}>
        —
      </Badge>
    );
  }

  const Icon = ICONS[level];
  const label = t(`level_${level}` as any);

  const color
    = level === 1
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
      : level === 2
        ? 'bg-lime-100 text-lime-950 dark:bg-lime-950 dark:text-lime-50'
        : level === 3
          ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-50'
          : level === 4
            ? 'bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-50'
            : 'bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-50';

  return (
    <Badge className={cn('gap-1.5 tabular-nums', color, className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="font-semibold">{painLevelDisplay(level)}</span>
      <span className="hidden sm:inline">{label}</span>
    </Badge>
  );
}
