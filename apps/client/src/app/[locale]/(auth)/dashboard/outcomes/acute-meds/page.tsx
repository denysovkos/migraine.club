import { getTranslations } from 'next-intl/server';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { AcuteMedsReportView } from '@/features/outcomes/AcuteMedsReportView';

export default async function AcuteMedsReportPage() {
  const t = await getTranslations('Outcomes');
  return (
    <>
      <TitleBar
        title={t('acute_report_title')}
        description={t('acute_report_description')}
      />
      <AcuteMedsReportView />
    </>
  );
}
