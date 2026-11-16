'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { fetchMohStatus } from '@/features/quickAdd/acuteMedsApi';

export function MohGuardrailBanner(props: { refreshToken?: number }) {
  const [status, setStatus] = useState<'ok' | 'approaching' | 'exceeded'>('ok');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchMohStatus()
      .then((data) => {
        setStatus(data.status);
        setMessage(data.message);
      })
      .catch(() => {
        setStatus('ok');
        setMessage(null);
      });
  }, [props.refreshToken]);

  if (status === 'ok' || !message) {
    return null;
  }

  return (
    <div className={status === 'exceeded'
      ? 'rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm'
      : 'rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm'}
    >
      <div className="font-medium">
        {status === 'exceeded' ? 'Medication use guardrail exceeded' : 'Medication use guardrail approaching'}
      </div>
      <div className="mt-1 text-muted-foreground">
        {message}
      </div>
      <Link href="/dashboard/reports/clinician" className="mt-2 inline-block text-sm font-medium text-primary underline">
        Open Clinician Report export
      </Link>
    </div>
  );
}
