'use client';

import type { EnrollmentDTO } from './programsApi';
import type { ProgramSettingsDTO } from '@/services/programs/programSettingsService';
import { useTranslations } from 'next-intl';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { showSnackbar } from '@/features/snackbar';
import {
  endEnrollment,
  fetchEnrollments,
  fetchProgramSettings,
  pauseEnrollment,
  resumeEnrollment,
  updateProgramSettings,
} from './programsApi';

type NotifKey = 'windDown' | 'morningCheckIn' | 'onsetNudge' | 'weeklyDigest';

export function ProgramSettingsForm() {
  const t = useTranslations('ProgramSettings');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifs, setNotifs] = useState<ProgramSettingsDTO['notificationsConfig']>({});
  const [savingNotif, setSavingNotif] = useState<NotifKey | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchProgramSettings()
      .then((s) => {
        if (mounted) {
          setEnabled(s.enabled);
          setNotifs(s.notificationsConfig ?? {});
        }
      })
      .catch(() => {
        if (mounted) {
          setError(t('load_error'));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [t]);

  async function toggleNotif(key: NotifKey, next: boolean) {
    try {
      setSavingNotif(key);
      const merged = { ...notifs, [key]: next };
      await updateProgramSettings({ notificationsConfig: merged });
      setNotifs(merged);
    } catch {
      setError(t('save_error'));
    } finally {
      setSavingNotif(null);
    }
  }

  useEffect(() => {
    if (!enabled) {
      setEnrollments(null);
      return;
    }
    let cancelled = false;
    fetchEnrollments()
      .then((res) => {
        if (!cancelled) {
          setEnrollments(res.enrollments);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnrollments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function refreshEnrollments() {
    const res = await fetchEnrollments().catch(() => null);
    if (res) {
      setEnrollments(res.enrollments);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('loading')}</div>
    );
  }

  const displayed = enrollments?.filter(e => e.status === 'active' || e.status === 'paused') ?? [];

  const notifRows: { key: NotifKey; titleKey: string; hintKey: string }[] = [
    { key: 'windDown', titleKey: 'notif_wind_down_title', hintKey: 'notif_wind_down_hint' },
    { key: 'morningCheckIn', titleKey: 'notif_morning_title', hintKey: 'notif_morning_hint' },
    { key: 'onsetNudge', titleKey: 'notif_onset_title', hintKey: 'notif_onset_hint' },
    { key: 'weeklyDigest', titleKey: 'notif_weekly_title', hintKey: 'notif_weekly_hint' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <div className="text-sm font-medium">{t('module_enabled_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('module_enabled_hint')}</div>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          onCheckedChange={async (next) => {
            try {
              setSaving(true);
              setError(null);
              await updateProgramSettings({ enabled: next });
              setEnabled(next);
            } catch {
              setError(t('save_error'));
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>

      {enabled && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{t('browse_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('browse_hint')}</div>
          <Button asChild className="mt-3 min-h-11 w-full sm:w-auto">
            <Link href="/dashboard/programs">{t('browse_cta')}</Link>
          </Button>
        </div>
      )}

      {enabled && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{t('active_enrollments_title')}</div>
          {enrollments === null
            ? (
                <div className="mt-2 text-xs text-muted-foreground">{t('loading')}</div>
              )
            : displayed.length === 0
              ? (
                  <div className="mt-2 text-xs text-muted-foreground">{t('no_enrollments')}</div>
                )
              : (
                  <ul className="mt-2 space-y-2">
                    {displayed.map(e => (
                      <li
                        key={e.id}
                        className="flex flex-col gap-2 rounded-md border bg-card/40 p-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-sm">
                            <Link
                              href={`/dashboard/programs/${e.programId}/progress`}
                              className="font-medium hover:underline"
                            >
                              {e.programId}
                            </Link>
                            {e.status === 'paused' && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                {t('status_paused')}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t('since', { date: e.startDate })}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {e.status === 'active'
                            ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="min-h-9"
                                  onClick={async () => {
                                    await pauseEnrollment(e.programId, e.id);
                                    showSnackbar({ message: t('paused_toast') });
                                    refreshEnrollments();
                                  }}
                                >
                                  {t('pause')}
                                </Button>
                              )
                            : (
                                <Button
                                  size="sm"
                                  className="min-h-9"
                                  onClick={async () => {
                                    await resumeEnrollment(e.programId, e.id);
                                    showSnackbar({ message: t('resumed_toast') });
                                    refreshEnrollments();
                                  }}
                                >
                                  {t('resume')}
                                </Button>
                              )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-9"
                            onClick={async () => {
                              await endEnrollment(e.programId, e.id);
                              showSnackbar({ message: t('ended_toast') });
                              refreshEnrollments();
                            }}
                          >
                            {t('end')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      )}

      {enabled && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">{t('notifications_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('notifications_hint')}</div>
          <ul className="mt-3 divide-y">
            {notifRows.map(row => (
              <li key={row.key} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-sm">{t(row.titleKey as never)}</div>
                  <div className="text-xs text-muted-foreground">{t(row.hintKey as never)}</div>
                </div>
                <Switch
                  checked={Boolean(notifs?.[row.key])}
                  disabled={savingNotif === row.key}
                  onCheckedChange={next => toggleNotif(row.key, next)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    </div>
  );
}
