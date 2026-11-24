import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { ProgramSettingsForm } from '@/features/programs/ProgramSettingsForm';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('programs.meta_title'),
    description: t('programs.meta_description'),
  };
}

export default async function ProgramsSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('programs.title')}
      description={t('programs.description')}
    >
      <ProgramSettingsForm />
    </DashboardSection>
  );
}
