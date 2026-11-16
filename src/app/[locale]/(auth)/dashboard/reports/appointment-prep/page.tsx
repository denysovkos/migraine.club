import { getTranslations } from 'next-intl/server';

import { AppointmentPrepListView } from '@/features/appointmentPrep/AppointmentPrepListView';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function AppointmentPrepReportsPage() {
  const t = await getTranslations('AppointmentPrep');

  return (
    <>
      <TitleBar
        title={t('title')}
        description={t('description')}
      />
      <AppointmentPrepListView />
    </>
  );
}
