'use client';

import { useTranslations } from 'next-intl';

import { HealthDataConsentGuard } from '@/features/consent';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ProgramsLibraryView } from '@/features/programs/ProgramsLibraryView';

export default function ProgramsLibraryPage() {
  const t = useTranslations('ProgramsLibrary');

  return (
    <HealthDataConsentGuard>
      <TitleBar title={t('title')} description={t('description')} />
      <div className="mt-6">
        <ProgramsLibraryView />
      </div>
    </HealthDataConsentGuard>
  );
}
