'use client';

import type { Episode, ProtectorType, TriggerType } from '@/types/Episode';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

import { PROTECTOR_VALUE_TO_KEY, TRIGGER_VALUE_TO_KEY } from './episodeFactorMappings';

type EpisodeFactorSummaryProps = {
  episode: Episode;
  maxVisible?: number;
};

type FactorBadge = {
  key: string;
  label: string;
  tone: 'trigger' | 'protector';
};

function getTriggerTranslationKey(trigger: TriggerType): string {
  return TRIGGER_VALUE_TO_KEY[trigger] ?? 'other';
}

function getProtectorTranslationKey(protector: ProtectorType): string {
  const key = PROTECTOR_VALUE_TO_KEY[protector];
  if (!key) {
    return 'other';
  }
  if (key === 'physical_activity') {
    return 'exercise';
  }
  return key === 'other_protector' ? 'other' : key;
}

export function EpisodeFactorSummary({
  episode,
  maxVisible = 3,
}: EpisodeFactorSummaryProps) {
  const t = useTranslations('EpisodesTable');
  const tTrigger = useTranslations('Factors.builtins.trigger');
  const tProtector = useTranslations('Factors.builtins.protector');

  const items: FactorBadge[] = [
    ...episode.triggers.map(trigger => ({
      key: `trigger-${trigger}`,
      label: tTrigger(getTriggerTranslationKey(trigger)),
      tone: 'trigger' as const,
    })),
    ...episode.protectors.map(protector => ({
      key: `protector-${protector}`,
      label: tProtector(getProtectorTranslationKey(protector)),
      tone: 'protector' as const,
    })),
  ];

  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('no_factors')}</span>;
  }

  const visibleItems = items.slice(0, maxVisible);
  const remainingCount = items.length - visibleItems.length;

  return (
    <div className="flex max-w-xs flex-wrap items-center gap-2 whitespace-normal">
      {visibleItems.map(item => (
        <Badge
          key={item.key}
          variant="outline"
          className={
            item.tone === 'trigger'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }
        >
          {item.label}
        </Badge>
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-muted-foreground">
          +
          {remainingCount}
          {' '}
          {t('more')}
        </span>
      )}
    </div>
  );
}
