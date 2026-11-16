import { CalendarCheck2, FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function ReportsPage() {
  const t = await getTranslations('Reports');

  return (
    <>
      <TitleBar
        title={t('title')}
        description={t('description')}
      />
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <FileText className="size-5" />
                {t('clinician_title')}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t('clinician_description')}
              </div>
            </div>
            <Button asChild className="min-h-11">
              <Link href="/dashboard/reports/clinician">{t('clinician_button')}</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <CalendarCheck2 className="size-5" />
                {t('appointment_prep_title')}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t('appointment_prep_description')}
              </div>
            </div>
            <Button asChild className="min-h-11">
              <Link href="/dashboard/reports/appointment-prep">{t('appointment_prep_button')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
