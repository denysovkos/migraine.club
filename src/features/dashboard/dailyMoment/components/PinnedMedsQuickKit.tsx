'use client';

import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createAcuteDose, fetchMohStatus } from '@/features/quickAdd/acuteMedsApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';
import { cn } from '@/utils/Helpers';

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

function suffix(dose: string | null, unit: string | null) {
  const s = [dose, unit].filter(Boolean).join(' ');
  return s ? ` ${s}` : '';
}

export function PinnedMedsQuickKit(props: {
  refreshToken?: number;
  onDidLog?: () => void;
}) {
  const router = useRouter();
  const tHome = useTranslations('DashboardHome');
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<PinnedMed[]>([]);
  const [mohLine, setMohLine] = useState<string | null>(null);
  const [takeOpen, setTakeOpen] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controllerAtMount = controllerRef.current;
    let cancelled = false;
    setLoading(true);
    fetchPinned()
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setPinned(rows);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controllerAtMount?.abort();
    };
  }, [props.refreshToken]);

  const hasPinned = useMemo(() => pinned.length > 0, [pinned]);

  async function refreshMohLine() {
    try {
      const moh = await fetchMohStatus();
      const relevant = moh.perClass.find(c => c.status !== 'ok' || c.rolling30DaysUsed > 0);
      if (!relevant) {
        setMohLine(null);
        return;
      }
      const label = relevant.medicationClass
        .replaceAll('_', ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      setMohLine(`${label}: ${relevant.rolling30DaysUsed}/${relevant.threshold} days (rolling 30)`);
    } catch {
      setMohLine(null);
    }
  }

  useEffect(() => {
    refreshMohLine().catch(() => {});
  }, [props.refreshToken]);

  async function logPinned(med: PinnedMed) {
    try {
      await createAcuteDose({
        medicationId: med.id,
        dose: med.defaultDose ?? undefined,
        unit: med.defaultUnit ?? undefined,
        unitIsCustom: med.defaultUnitIsCustom ? true : undefined,
      });
      showSnackbar({
        message: tHome('snackbar_logged_med', { name: med.label, dose: suffix(med.defaultDose, med.defaultUnit) }),
      });
      await refreshMohLine();
      props.onDidLog?.();
      router.refresh();
    } catch (e: any) {
      showSnackbar({ message: e?.message || tHome('error_log_medication') });
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/40">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold">{tHome('quick_kit_title')}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{tHome('quick_kit_subtitle')}</div>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted"
          onClick={() => setTakeOpen(true)}
        >
          <Search className="size-4" />
          {tHome('search_more_meds')}
        </button>
      </div>

      <div className="mt-3">
        {mohLine && (
          <div className="mb-2 text-xs text-muted-foreground">
            {mohLine}
          </div>
        )}
        {loading && (
          <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
        )}

        {!loading && !hasPinned && (
          <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            {tHome('pinned_empty')}
          </div>
        )}

        {!loading && hasPinned && (
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {pinned.map(m => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  'flex min-h-11 shrink-0 items-center gap-3 rounded-full bg-muted px-3 pr-2 text-left text-sm hover:bg-muted/70',
                )}
                onClick={() => logPinned(m)}
              >
                <div className="min-w-0">
                  <div className="max-w-[220px] truncate font-medium">{m.label}</div>
                  {(m.defaultDose || m.defaultUnit) && (
                    <div className="text-xs text-muted-foreground">
                      {[m.defaultDose, m.defaultUnit].filter(Boolean).join(' ')}
                    </div>
                  )}
                </div>
                <span className="ml-1 inline-flex size-9 items-center justify-center rounded-full bg-background">
                  <Plus className="size-4" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={setTakeOpen}
        onDidLog={() => props.onDidLog?.()}
      />
    </div>
  );
}
