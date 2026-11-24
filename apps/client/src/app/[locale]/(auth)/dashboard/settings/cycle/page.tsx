import { getTranslations } from 'next-intl/server';

import { CycleSettingsForm } from '@/features/cycle/CycleSettingsForm';
import { DashboardSection } from '@/features/dashboard/DashboardSection';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('cycle.meta_title'),
    description: t('cycle.meta_description'),
  };
}

export default async function CycleSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('cycle.title')}
      description={t('cycle.description')}
    >
      <CycleSettingsForm />
    </DashboardSection>
  );
}
