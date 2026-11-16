'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { fetchIntake } from './intakeApi';

type GateState = 'loading' | 'redirecting' | 'allow';

// A hung status request must never leave the user staring at a spinner.
const GATE_TIMEOUT_MS = 5000;

/**
 * Sends a user who has never been through intake to the wizard, once.
 *
 * Fails open: if the status request errors, is malformed, or simply never
 * resolves, the dashboard renders. A flaky endpoint must never lock someone
 * out of their own health log.
 */
export function IntakeGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    let cancelled = false;
    // Set once the timeout fires so a fetch that resolves afterwards can no
    // longer redirect a user who is already looking at their dashboard.
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!cancelled) {
        setState('allow');
      }
    }, GATE_TIMEOUT_MS);

    fetchIntake()
      .then((dto) => {
        if (cancelled || timedOut) {
          return;
        }
        clearTimeout(timer);
        if (dto.status === 'in_progress') {
          setState('redirecting');
          router.replace('/onboarding');
          return;
        }
        setState('allow');
      })
      .catch(() => {
        if (cancelled || timedOut) {
          return;
        }
        clearTimeout(timer);
        setState('allow');
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  if (state === 'loading' || state === 'redirecting') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
