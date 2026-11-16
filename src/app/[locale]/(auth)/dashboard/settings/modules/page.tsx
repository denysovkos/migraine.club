import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { ModulesSettingsForm } from '@/features/settings/ModulesSettingsForm';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('modules.meta_title'),
    description: t('modules.meta_description'),
  };
}

export default async function ModulesSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('modules.title')}
      description={t('modules.description')}
    >
      <ModulesSettingsForm />
    </DashboardSection>
  );
}
