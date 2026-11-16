'use client';

import { useTranslations } from 'next-intl';

import { HealthDataConsentGuard } from '@/features/consent';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { InsightsView } from '@/features/insights/InsightsView';

export default function InsightsPage() {
  const t = useTranslations('Insights');

  return (
    <HealthDataConsentGuard>
      <TitleBar
        title={t('title')}
        description={t('subtitle')}
      />
      <div className="mt-6">
        <InsightsView />
      </div>
    </HealthDataConsentGuard>
  );
}
