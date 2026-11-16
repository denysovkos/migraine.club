'use client';

import { useTranslations } from 'next-intl';

import { LatestEpisodesWithWpi } from './LatestEpisodesWithWpi';
import { SolarForecastAlert } from './SolarForecastAlert';
import { SolarKpCard } from './SolarKpCard';
import { WpiCard } from './WpiCard';
import { WpiChart } from './WpiChart';

export function WeatherDashboard() {
  const t = useTranslations('WeatherPainIndex');

  return (
    <div className="space-y-6">
      {/* Solar Storm Alert */}
      <SolarForecastAlert />

      {/* Top row: WPI Card and Latest Episodes */}
      <div className="grid gap-6 lg:grid-cols-3">
        <WpiCard />
        <SolarKpCard />
        <LatestEpisodesWithWpi limit={3} />
      </div>

      {/* Chart */}
      <WpiChart days={7} />

      {/* Educational text */}
      <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        {t('education')}
      </div>
    </div>
  );
}
