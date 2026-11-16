'use client';

import { use } from 'react';

import { HealthDataConsentGuard } from '@/features/consent';
import { ProgramDetailView } from '@/features/programs/ProgramDetailView';

export default function ProgramDetailPage(
  props: {
    params: Promise<{ slug: string }>;
  },
) {
  const params = use(props.params);
  return (
    <HealthDataConsentGuard>
      <div className="mt-2">
        <ProgramDetailView programId={params.slug} />
      </div>
    </HealthDataConsentGuard>
  );
}
