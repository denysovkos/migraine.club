import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { DoctorVerificationSettings } from '@/features/doctorVerification';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('doctor_verification.meta_title'),
    description: t('doctor_verification.meta_description'),
  };
}

export default async function DoctorVerificationSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('doctor_verification.title')}
      description={t('doctor_verification.description')}
    >
      <DoctorVerificationSettings />
    </DashboardSection>
  );
}
