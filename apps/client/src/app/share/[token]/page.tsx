import type { Metadata } from 'next';

import { ShareReportView } from '@/features/share/ShareReportView';

export const metadata: Metadata = {
  title: 'Migraine Report - Migrennity',
  description: 'Secure telemedicine migraine report',
  // Prevent indexing of shared reports
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Public share page for doctors to view patient migraine data.
 *
 * Security features:
 * - No authentication required (token-based access)
 * - Token validation on server-side API
 * - Expiration checking
 * - Read-only view
 * - No tracking/analytics
 * - HTTPS enforced in production
 */
export default async function ShareReportPage(
  props: {
    params: Promise<{ token: string }>;
  },
) {
  const params = await props.params;
  return <ShareReportView token={params.token} />;
}
