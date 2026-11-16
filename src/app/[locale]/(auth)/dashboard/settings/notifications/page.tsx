import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { NotificationSettingsForm } from '@/features/notifications';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('notifications.meta_title'),
    description: t('notifications.meta_description'),
  };
}

/**
 * Notification settings page - allows users to enable/disable push notifications.
 */
export default async function NotificationSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('notifications.title')}
      description={t('notifications.description')}
    >
      <NotificationSettingsForm />
    </DashboardSection>
  );
}
