import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { WeatherSettingsForm } from '@/features/weather/WeatherSettingsForm';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('location.meta_title'),
    description: t('location.meta_description'),
  };
}

export default async function LocationSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('location.title')}
      description={t('location.description')}
    >
      <WeatherSettingsForm />
    </DashboardSection>
  );
}
