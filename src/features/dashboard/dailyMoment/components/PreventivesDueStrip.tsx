'use client';

import type { PreventiveDueResponse } from '@/features/preventives/preventivesApi';
import { Check, HelpCircle, Minus, Pill } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { fetchPreventiveDue, upsertPreventiveIntake } from '@/features/preventives/preventivesApi';
import { showSnackbar } from '@/features/snackbar';
import { trackEvent } from '@/utils/analytics';
import { cn } from '@/utils/Helpers';

type SelectedPlan = {
  id: string;
  name: string;
};

export function PreventivesDueStrip(props: { refreshToken?: number; onDidLog?: () => void }) {
  const t = useTranslations('Preventives');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PreventiveDueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedPlan | null>(null);
  const [showNotDue, setShowNotDue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPreventiveDue()
      .then((res) => {
        if (cancelled) {
          return;
        }
        setData(res);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : t('error_generic'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshToken, t]);

  const hasPlans = data?.hasActivePlans ?? false;
  const hasDue = (data?.due?.length ?? 0) > 0;
  const hasNotDue = (data?.notDue?.length ?? 0) > 0;

  const openSheetFor = (planId: string, name: string) => {
    setSelected({ id: planId, name });
    setSheetOpen(true);
  };

  const setState = async (state: 'taken' | 'missed' | 'unsure') => {
    if (!selected || !data) {
      return;
    }
    try {
      await upsertPreventiveIntake({
        planId: selected.id,
        localDate: data.todayLocalDate,
        state,
      });
      trackEvent('intake_logged', { state });
      setData((prev) => {
        if (!prev) {
          return prev;
        }
        const due = prev.due.map((p) => {
          if (p.id !== selected.id) {
            return p;
          }
          return { ...p, state };
        });
        return { ...prev, due };
      });
      showSnackbar({ message: t('intake_saved') });
      props.onDidLog?.();
      setSheetOpen(false);
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('error_generic') });
    }
  };

  const insight = data?.insight ?? null;
  const insightText = useMemo(() => {
    if (!insight) {
      return null;
    }
    const adherence = insight.adherencePct === null
      ? t('adherence_na')
      : t('adherence_pct', { pct: Math.round(insight.adherencePct * 100) });
    return t('insight_copy', {
      adherence,
      migraineDays: insight.migraineDays,
      from: insight.from,
      to: insight.to,
    });
  }, [insight, t]);

  return (
    <>
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">{t('due_title')}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{t('due_subtitle')}</div>
          </div>
          <Link
            href="/dashboard/settings/treatments"
            className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted"
          >
            {t('manage')}
          </Link>
        </div>

        {loading && (
          <div className="mt-3 h-11 w-full animate-pulse rounded-xl bg-muted" />
        )}

        {!loading && error && (
          <div className="mt-3 rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !hasPlans && (
          <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">{t('empty_title')}</div>
            <div className="mt-1">{t('empty_body')}</div>
            <Link
              href="/dashboard/settings/treatments"
              className="mt-3 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              {t('add_cta')}
            </Link>
          </div>
        )}

        {!loading && !error && hasPlans && (
          <>
            {hasDue && (
              <div className="mt-3">
                <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                  {data?.due.map((p) => {
                    const stateLabel = p.state === 'taken'
                      ? t('state_taken')
                      : p.state === 'missed'
                        ? t('state_missed')
                        : p.state === 'unsure'
                          ? t('state_unsure')
                          : t('state_prompt');
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={cn(
                          'flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-muted px-3 text-left text-sm hover:bg-muted/70',
                          p.isOverdue && 'ring-1 ring-amber-400/70',
                        )}
                        onClick={() => openSheetFor(p.id, p.name)}
                        aria-label={`${p.name} ${stateLabel}`}
                      >
                        <div className="min-w-0">
                          <div className="max-w-[220px] truncate font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.scheduleLabel}</div>
                        </div>
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs">
                          {p.state === 'taken' && <Check className="size-3.5 text-emerald-600" />}
                          {p.state === 'missed' && <Minus className="size-3.5 text-amber-600" />}
                          {p.state === 'unsure' && <HelpCircle className="size-3.5 text-muted-foreground" />}
                          <span>{stateLabel}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!hasDue && (
              <div className="mt-3 rounded-xl bg-muted/30 p-3 text-sm text-muted-foreground">
                {t('none_due')}
              </div>
            )}

            {hasNotDue && (
              <div className="mt-3">
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNotDue(s => !s)}
                >
                  {showNotDue ? t('not_due_hide') : t('not_due_show')}
                </button>
                {showNotDue && (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                    {data?.notDue.map(p => (
                      <div
                        key={p.id}
                        className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-muted/50 px-3 text-left text-sm"
                      >
                        <div className="min-w-0">
                          <div className="max-w-[220px] truncate font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.scheduleLabel}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {insightText && (
              <div className="mt-4 rounded-xl bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Pill className="size-4" />
                  {t('insight_title')}
                </div>
                <div className="mt-1 text-muted-foreground">{insightText}</div>
              </div>
            )}
          </>
        )}
      </div>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={selected ? t('sheet_title', { name: selected.name }) : t('sheet_title_empty')}
      >
        <div className="space-y-2">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border bg-background px-4 text-left text-sm font-medium hover:bg-muted"
            onClick={() => setState('taken')}
          >
            <span className="inline-flex items-center gap-2">
              <Check className="size-4 text-emerald-600" />
              {t('state_taken')}
            </span>
          </button>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border bg-background px-4 text-left text-sm font-medium hover:bg-muted"
            onClick={() => setState('missed')}
          >
            <span className="inline-flex items-center gap-2">
              <Minus className="size-4 text-amber-600" />
              {t('state_missed')}
            </span>
          </button>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border bg-background px-4 text-left text-sm font-medium hover:bg-muted"
            onClick={() => setState('unsure')}
          >
            <span className="inline-flex items-center gap-2">
              <HelpCircle className="size-4 text-muted-foreground" />
              {t('state_unsure')}
            </span>
          </button>
          <Button type="button" variant="outline" className="mt-2 min-h-11 w-full" onClick={() => setSheetOpen(false)}>
            {t('close')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
