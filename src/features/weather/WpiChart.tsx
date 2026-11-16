'use client';

import type { Episode } from '@/types/Episode';
import type { WpiHistoryPoint } from '@/types/WeatherPainIndex';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { normalizeToPainLevel, painLevelDisplay } from '@/utils/painLevel';

type ChartDataPoint = {
  timestamp: Date;
  dateStr: string;
  wpi: number;
  kpIndex: number | null;
  episode?: {
    id: number;
    intensity: number;
  };
};

type RecentEpisodesResponse = {
  episodes: (Episode & {
    weatherPainIndexId?: string | null;
    weatherContext?: {
      wpiScore?: number;
      wpiLevel?: string;
      kpIndex?: number | null;
    } | null;
  })[];
};

export function WpiChart({ days = 7 }: { days?: number }) {
  const t = useTranslations('WpiChart');
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch WPI history and recent episodes in parallel
        const [historyRes, episodesRes] = await Promise.all([
          fetch(`/api/weather-pain-index/history?days=${days}`),
          fetch(`/api/episodes/recent?limit=20`),
        ]);

        if (!historyRes.ok) {
          throw new Error('Failed to fetch WPI history');
        }

        const historyData: { points: WpiHistoryPoint[] } = await historyRes.json();
        const episodesData: RecentEpisodesResponse = episodesRes.ok
          ? await episodesRes.json()
          : { episodes: [] };

        // Create a map of episode dates to episodes (per day)
        const episodesByDate = new Map<string, Episode>();
        for (const episode of episodesData.episodes) {
          const dateKey = format(new Date(episode.startTime), 'yyyy-MM-dd');
          episodesByDate.set(dateKey, episode);
        }

        // Transform history points to chart data
        const data: ChartDataPoint[] = historyData.points.map((point) => {
          const timestamp = new Date(point.timestamp);
          const dateKey = format(timestamp, 'yyyy-MM-dd');
          const episode = episodesByDate.get(dateKey);

          return {
            timestamp,
            dateStr: format(timestamp, 'MMM d'),
            wpi: point.score,
            kpIndex: point.kpIndex,
            episode: episode
              ? {
                  id: episode.id,
                  intensity: episode.intensity,
                }
              : undefined,
          };
        });

        // Sort by date
        data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        setChartData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [days]);

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted"></div>
        <div className="h-64 animate-pulse rounded bg-muted"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <p className="mt-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('no_data')}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold">
        {t('title_with_days', { days })}
      </h3>

      {/* Important: ensure the container has width */}
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="dateStr"
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
            />
            <YAxis
              yAxisId="wpi"
              domain={[0, 10]}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
              label={{
                value: 'WPI',
                angle: -90,
                position: 'insideLeft',
                fill: 'currentColor',
                fontSize: 12,
              }}
            />
            <YAxis
              yAxisId="kp"
              orientation="right"
              domain={[0, 9]}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
              label={{
                value: 'Kp',
                angle: 90,
                position: 'insideRight',
                fill: 'currentColor',
                fontSize: 12,
              }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) {
                  return null;
                }
                const data = payload[0]?.payload as ChartDataPoint;
                return (
                  <div className="rounded-lg border bg-popover p-3 text-sm shadow-lg">
                    <p className="font-medium">
                      {format(data.timestamp, 'MMM d, yyyy HH:mm')}
                    </p>
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      <p>
                        WPI:
                        {' '}
                        <span className="font-medium text-foreground">
                          {data.wpi.toFixed(1)}
                        </span>
                      </p>
                      <p>
                        Kp:
                        {' '}
                        <span className="font-medium text-foreground">
                          {data.kpIndex?.toFixed(1) ?? 'N/A'}
                        </span>
                      </p>
                      {data.episode && (
                        <p className="text-destructive">
                          {t('migraine_pain', {
                            intensity: (() => {
                              const level = normalizeToPainLevel(data.episode.intensity);
                              return level ? painLevelDisplay(level) : '—';
                            })(),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Line
              yAxisId="wpi"
              type="monotone"
              dataKey="wpi"
              name="WPI"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              // Draw markers only for points with an episode
              dot={(props: any) => {
                const { cx, cy, payload } = props;
                if (!payload?.episode) {
                  return null;
                }
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="hsl(var(--destructive))"
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 4 }}
            />
            <Line
              yAxisId="kp"
              type="monotone"
              dataKey="kpIndex"
              name={t('kp_index_legend')}
              stroke="hsl(var(--destructive))"
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 5"
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-6 rounded bg-primary" />
          <span>WPI</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-6 rounded bg-destructive opacity-90" />
          <span>{t('kp_index_legend')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-destructive"></div>
          <span>{t('migraine_episode')}</span>
        </div>
      </div>
    </div>
  );
}
