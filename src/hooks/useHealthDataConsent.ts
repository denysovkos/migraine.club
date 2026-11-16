'use client';

import { useCallback, useEffect, useState } from 'react';

type ConsentStatus = {
  hasConsent: boolean;
  isLoading: boolean;
  error: string | null;
};

export function useHealthDataConsent() {
  const [status, setStatus] = useState<ConsentStatus>({
    hasConsent: false,
    isLoading: true,
    error: null,
  });

  const fetchConsentStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/user/consent');
      if (response.ok) {
        const data = await response.json();
        const hasConsent = !!data.consents?.health_data
          && !!data.consents?.terms
          && !!data.consents?.privacy;
        setStatus({
          hasConsent,
          isLoading: false,
          error: null,
        });
      } else {
        setStatus(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to fetch consent status',
        }));
      }
    } catch {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to fetch consent status',
      }));
    }
  }, []);

  useEffect(() => {
    fetchConsentStatus();
  }, [fetchConsentStatus]);

  const giveConsent = useCallback(async () => {
    try {
      const consents = ['health_data', 'terms', 'privacy'] as const;
      const responses = await Promise.all(consents.map(consentType => fetch('/api/user/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentType,
          version: '1.0',
        }),
      })));

      if (responses.every(r => r.ok)) {
        setStatus({
          hasConsent: true,
          isLoading: false,
          error: null,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    ...status,
    giveConsent,
    refetch: fetchConsentStatus,
  };
}
