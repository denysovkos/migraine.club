'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { BasicTableFeatures } from '@/components/ui/table-features';
import type { Episode } from '@/types/Episode';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { useMemo } from 'react';
import { PainLevelBadge } from '@/components/PainLevelBadge';
import { Badge } from '@/components/ui/badge';

import { ClickableDataTable } from './ClickableDataTable';
import { AttackTypeBadge } from './components/AttackTypeBadge';
import { EpisodeFactorSummary } from './EpisodeFactorSummary';

type EpisodesTableProps = {
  episodes: Episode[];
  sharedEpisodes?: Record<number, string>;
  onRowClick?: (episodeId: number) => void;
};

export function EpisodesTable({ episodes, onRowClick }: EpisodesTableProps) {
  const t = useTranslations('EpisodesTable');
  const router = useRouter();

  const handleRowClick = (episode: Episode) => {
    if (onRowClick) {
      onRowClick(episode.id);
    } else {
      router.push(`/dashboard/episodes/${episode.id}`);
    }
  };

  const columns = useMemo<ColumnDef<BasicTableFeatures, Episode, unknown>[]>(
    () => [
      {
        accessorKey: 'startTime',
        header: t('when_header'),
        cell: ({ row }) => {
          const date = new Date(row.original.startTime);
          const isToday = new Date().toDateString() === date.toDateString();

          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {isToday
                  ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(date, { addSuffix: true })}
              </span>
            </div>
          );
        },
      },
      {
        id: 'type',
        header: t('type_header'),
        cell: ({ row }) => <AttackTypeBadge episode={row.original} />,
      },
      {
        accessorKey: 'intensity',
        header: t('intensity_header'),
        cell: ({ row }) => <PainLevelBadge value={row.original.intensity} />,
      },
      {
        id: 'status',
        header: t('status_header'),
        cell: ({ row }) => {
          if (row.original.isOngoing) {
            return (
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                <Clock className="size-3" />
                {t('ongoing')}
              </Badge>
            );
          }

          // Calculate duration if we have end time
          if (row.original.endTime) {
            const start = new Date(row.original.startTime);
            const end = new Date(row.original.endTime);
            const durationMs = end.getTime() - start.getTime();
            const hours = Math.floor(durationMs / (1000 * 60 * 60));
            const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 0) {
              return (
                <span className="text-sm text-muted-foreground">
                  {hours}
                  h
                  {' '}
                  {minutes}
                  m
                </span>
              );
            }
            return (
              <span className="text-sm text-muted-foreground">
                {minutes}
                m
              </span>
            );
          }

          return <span className="text-muted-foreground">-</span>;
        },
      },
      {
        id: 'factors',
        header: t('factors_header'),
        cell: ({ row }) => <EpisodeFactorSummary episode={row.original} />,
      },
      {
        id: 'actions',
        header: '',
        cell: () => (
          <div className="flex size-8 items-center justify-center text-muted-foreground">
            <ChevronRight className="size-5" />
          </div>
        ),
      },
    ],
    [t],
  );

  return (
    <ClickableDataTable
      columns={columns}
      data={episodes}
      onRowClick={handleRowClick}
    />
  );
}
