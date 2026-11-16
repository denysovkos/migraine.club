'use client';

import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { createAcuteDose, fetchMohStatus } from '@/features/quickAdd/acuteMedsApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';

import { CardHeader } from './CardHeader';

type PinnedMed = {
  id: string;
  label: string;
  defaultDose: string | null;
  defaultUnit: string | null;
  defaultUnitIsCustom: boolean;
  medicationClass: string;
  isAcute: boolean;
  isPinned: boolean;
};

async function fetchPinned(): Promise<PinnedMed[]> {
  const res = await fetch('/api/user-medications', { cache: 'no-store' });
  if (!res.ok) {
    return [];
  }
  const data = await res.json().catch(() => ({ pinned: [] }));
  return (data?.pinned ?? []) as PinnedMed[];
}

function classLabel(medicationClass: string): string {
  return medicationClass
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function QuickKitCard({ refreshToken, onDidLog }: { refreshToken?: number; onDidLog?: () => void }) {
  const t = useTranslations('DashboardHome');
  const router = useRouter();
  const [pinned, setPinned] = useState<PinnedMed[]>([]);
  const [loading, setLoading] = useState(true);
  const [mohLine, setMohLine] = useState<string | null>(null);
  const [takeOpen, setTakeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPinned()
      .then((rows) => {
        if (!cancelled) {
          setPinned(rows);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    fetchMohStatus()
      .then((moh) => {
        if (cancelled) {
          return;
        }
        const relevant = moh.perClass.find(c => c.status !== 'ok' || c.rolling30DaysUsed > 0);
        if (!relevant) {
          setMohLine(null);
          return;
        }
        setMohLine(
          `${classLabel(relevant.medicationClass)}: ${relevant.rolling30DaysUsed}/${relevant.threshold} days (rolling 30)`,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMohLine(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const hasPinned = useMemo(() => pinned.length > 0, [pinned]);

  async function logPinned(med: PinnedMed) {
    try {
      await createAcuteDose({
        medicationId: med.id,
        dose: med.defaultDose ?? undefined,
        unit: med.defaultUnit ?? undefined,
        unitIsCustom: med.defaultUnitIsCustom ? true : undefined,
      });
      const suffix = [med.defaultDose, med.defaultUnit].filter(Boolean).join(' ');
      showSnackbar({ message: t('snackbar_logged_med', { name: med.label, dose: suffix ? ` ${suffix}` : '' }) });
      onDidLog?.();
      router.refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('failed_log_medication') });
    }
  }

  return (
    <>
      <section id="quick-kit" className="mc-card">
        <CardHeader
          eyebrow={t('quickkit_title')}
          title={t('quickkit_subtitle')}
          sub={mohLine ?? undefined}
          action={{ label: t('quickkit_action'), onClick: () => setTakeOpen(true) }}
        />

        {loading && (
          <div className="h-11 w-full animate-pulse rounded-xl" style={{ background: 'var(--mc-bg-subtle)' }} />
        )}

        {!loading && !hasPinned && (
          <div
            className="rounded-xl p-3 text-[13px]"
            style={{ background: 'var(--mc-bg-subtle)', color: 'var(--mc-fg-muted)' }}
          >
            {t('quickkit_empty_prefix')}
            {' '}
            <span className="font-semibold">{t('quickkit_action')}</span>
            {' '}
            {t('quickkit_empty_suffix')}
          </div>
        )}

        {!loading && hasPinned && (
          <div
            className="mc-h-scroll"
            style={{
              maskImage: 'linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%)',
            }}
          >
            {pinned.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => logPinned(m)}
                className="mc-chip mc-ring"
              >
                <span className="mc-dot" />
                <span>{m.label}</span>
                {(m.defaultDose || m.defaultUnit) && (
                  <span style={{ color: 'var(--mc-fg-muted)', fontWeight: 500 }}>
                    {[m.defaultDose, m.defaultUnit].filter(Boolean).join(' ')}
                  </span>
                )}
                <Plus className="size-3.5" strokeWidth={2} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTakeOpen(true)}
              className="mc-chip mc-ring"
              style={{ borderStyle: 'dashed', color: 'var(--mc-fg-muted)' }}
            >
              <Search className="size-3.5" />
              <span>{t('quickkit_search_meds')}</span>
            </button>
          </div>
        )}
      </section>

      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={setTakeOpen}
        onDidLog={() => onDidLog?.()}
      />
    </>
  );
}
