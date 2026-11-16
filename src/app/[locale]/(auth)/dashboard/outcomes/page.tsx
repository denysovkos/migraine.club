import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { OutcomesView } from '@/features/outcomes/OutcomesView';

export default function OutcomesPage() {
  const t = useTranslations('Outcomes');

  return (
    <>
      <TitleBar
        title={(
          <span className="flex items-center gap-2">
            <BarChart3 className="size-6" />
            {t('title')}
          </span>
        )}
        description={t('description')}
      />
      <div className="mb-4">
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-9">
            <Link href="/dashboard/reports/clinician">Export for doctor</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-9">
            <Link href="/dashboard/outcomes/acute-meds">Acute meds report</Link>
          </Button>
        </div>
      </div>
      <OutcomesView />
    </>
  );
}
