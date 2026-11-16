'use client';

import type { Episode } from '@/types/Episode';
import { Activity, Sparkles } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

export function AttackTypeBadge({ episode }: { episode: Episode }) {
  const t = useTranslations('Episodes');
  const attackType = episode.attackType ?? 'migraine';

  if (attackType === 'headache') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Activity className="size-3" />
        {t('type_headache')}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <Sparkles className="size-3" />
      {t('type_migraine')}
    </Badge>
  );
}
