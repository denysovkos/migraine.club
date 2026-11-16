import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { ProfileSettingsForm } from '@/features/profile';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('profile.meta_title'),
    description: t('profile.meta_description'),
  };
}

/**
 * Profile settings page - allows users to edit their display name and preferred language.
 */
export default async function ProfileSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('profile.title')}
      description={t('profile.description')}
    >
      <ProfileSettingsForm />
    </DashboardSection>
  );
}
