import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { MedicationsSettingsPage } from '@/features/medications/MedicationsSettingsPage';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('medications.meta_title'),
    description: t('medications.meta_description'),
  };
}

export default async function MedicationsSettingsRoute(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await props.params).locale, namespace: 'Settings' });

  return (
    <DashboardSection title={t('medications.title')} description={t('medications.description')}>
      <MedicationsSettingsPage />
    </DashboardSection>
  );
}
