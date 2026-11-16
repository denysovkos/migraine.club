'use client';

import { use } from 'react';

import { HealthDataConsentGuard } from '@/features/consent';
import { ProgramProgressView } from '@/features/programs/ProgramProgressView';

export default function ProgramProgressPage(
  props: {
    params: Promise<{ slug: string }>;
  },
) {
  const params = use(props.params);
  return (
    <HealthDataConsentGuard>
      <div className="mt-2">
        <ProgramProgressView programId={params.slug} />
      </div>
    </HealthDataConsentGuard>
  );
}
