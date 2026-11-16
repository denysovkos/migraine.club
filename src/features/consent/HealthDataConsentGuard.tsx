'use client';

import { useHealthDataConsent } from '@/hooks/useHealthDataConsent';

import { HealthDataConsentModal } from './HealthDataConsentModal';

type HealthDataConsentGuardProps = {
  children: React.ReactNode;
};

/**
 * Guard component that shows a consent modal if the user hasn't
 * given explicit consent for health data processing.
 *
 * Wrap dashboard/episode-related pages with this component.
 */
export function HealthDataConsentGuard({ children }: HealthDataConsentGuardProps) {
  const { hasConsent, isLoading, giveConsent } = useHealthDataConsent();

  // While loading, show nothing (or could show a spinner)
  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // If consent is not given, show the modal
  if (!hasConsent) {
    return <HealthDataConsentModal onConsent={giveConsent} />;
  }

  // Consent given, render children
  return <>{children}</>;
}
