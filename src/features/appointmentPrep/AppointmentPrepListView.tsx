'use client';

import type { AppointmentPrepDraftListItem } from './appointmentPrepApi';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { createAppointmentPrep, listAppointmentPreps } from './appointmentPrepApi';

function formatAppointmentDate(date: string) {
  const parsed = DateTime.fromISO(date);
  return parsed.isValid ? parsed.toLocaleString(DateTime.DATE_MED) : date;
}

export function AppointmentPrepListView() {
  const t = useTranslations('AppointmentPrep');
  const router = useRouter();
  const loadErrorMessage = t('load_error');
  const createErrorMessage = t('create_error');
  const [items, setItems] = useState<AppointmentPrepDraftListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;

    listAppointmentPreps()
      .then((drafts) => {
        if (!active) {
          return;
        }
        setItems(drafts);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setError(loadErrorMessage);
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadErrorMessage]);

  async function handleCreate() {
    setCreating(true);
    try {
      const appointmentDate = DateTime.now().plus({ days: 7 }).toISODate();
      if (!appointmentDate) {
        throw new Error('Failed to compute appointment date');
      }

      const created = await createAppointmentPrep({ appointmentDate });
      router.push(`/dashboard/reports/appointment-prep/${created.id}`);
    } catch {
      setError(createErrorMessage);
    } finally {
      setCreating(false);
    }
  }

  return (
    <DashboardSection title={t('list_title')} description={t('list_description')}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? t('creating') : t('create_button')}
        </Button>
      </div>

      {loading
        ? (
            <div className="rounded-lg border bg-background/60 p-4 text-sm text-muted-foreground">
              {t('loading')}
            </div>
          )
        : error
          ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {error}
              </div>
            )
          : items.length === 0
            ? (
                <div className="rounded-lg border bg-background/60 p-4 text-sm text-muted-foreground">
                  {t('empty_state')}
                </div>
              )
            : (
                <div className="space-y-3">
                  {items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40"
                      onClick={() => router.push(`/dashboard/reports/appointment-prep/${item.id}`)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {item.visitLabel || t('untitled_visit')}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatAppointmentDate(item.appointmentDate)}
                          </div>
                        </div>
                        {item.clinicianName
                          ? (
                              <div className="text-sm text-muted-foreground">{item.clinicianName}</div>
                            )
                          : null}
                      </div>
                      {item.visitReason
                        ? (
                            <div className="mt-2 text-sm text-muted-foreground">
                              {item.visitReason}
                            </div>
                          )
                        : null}
                    </button>
                  ))}
                </div>
              )}
    </DashboardSection>
  );
}
