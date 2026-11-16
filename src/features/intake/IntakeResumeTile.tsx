'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { fetchIntake } from './intakeApi';

const DISMISS_KEY = 'intake-resume-dismissed';

export function IntakeResumeTile() {
  const t = useTranslations('Intake');
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Unreadable storage (private mode, blocked site data, sandboxed
      // contexts) is treated as "not dismissed" rather than crashing.
      dismissed = false;
    }
    if (dismissed) {
      return;
    }
    fetchIntake()
      .then(dto => setShow(dto.status !== 'completed'))
      .catch(() => setShow(false));
  }, []);

  if (!show) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="mb-3 text-sm">{t('resume_tile_body')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.push('/onboarding')}
          className="min-h-[44px] rounded-lg bg-primary px-4 text-primary-foreground"
        >
          {t('resume_tile_cta')}
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // Unwritable storage still dismisses the tile for this
              // session via component state below.
            }
            setShow(false);
          }}
          className="min-h-[44px] rounded-lg border px-4"
        >
          {t('resume_tile_dismiss')}
        </button>
      </div>
    </div>
  );
}
