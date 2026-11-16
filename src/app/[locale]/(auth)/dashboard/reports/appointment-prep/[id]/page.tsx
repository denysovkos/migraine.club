import { getTranslations } from 'next-intl/server';

import { AppointmentPrepEditor } from '@/features/appointmentPrep/AppointmentPrepEditor';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function AppointmentPrepDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const params = await props.params;
  const t = await getTranslations('AppointmentPrep');

  return (
    <>
      <TitleBar
        title={t('detail_title')}
        description={t('detail_description')}
      />
      <AppointmentPrepEditor prepId={params.id} />
    </>
  );
}
