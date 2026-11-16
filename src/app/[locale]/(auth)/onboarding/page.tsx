'use client';

import { HealthDataConsentGuard } from '@/features/consent';
import { IntakeWizard } from '@/features/intake/IntakeWizard';
import { SnackbarViewport } from '@/features/snackbar';

export default function OnboardingPage() {
  return (
    <HealthDataConsentGuard>
      <IntakeWizard />
      <SnackbarViewport />
    </HealthDataConsentGuard>
  );
}
