import { getTranslations } from 'next-intl/server';

import { AdminHub } from '@/features/admin/AdminHub';
import { DashboardSection } from '@/features/dashboard/DashboardSection';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Admin',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function AdminPage(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Admin',
  });

  return (
    <DashboardSection title={t('title')} description={t('description')}>
      <AdminHub />
    </DashboardSection>
  );
}
