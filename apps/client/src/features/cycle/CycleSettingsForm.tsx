'use client';

import type { CycleSettings } from './cycleApi';
import { CycleHormoneProfile, CyclePrivacyMode } from '@migraine/db/schema';
import { useTranslations } from 'next-intl';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';

import { Switch } from '@/components/ui/switch';
import { deleteAllCycleData, fetchCycleSettings, updateCycleSettings } from './cycleApi';

const CONSENT_STORAGE_KEY = 'cycle_tracking_consent_v1';

const windowStartOptions = [-5, -4, -3, -2, -1, 0];
const windowEndOptions = [0, 1, 2, 3, 4, 5, 6, 7];

function defaultSettings(): CycleSettings {
  return {
    enabled: false,
    includeInExports: false,
    privacyMode: CyclePrivacyMode.LOCAL_ONLY,
    perimenstrualWindowStartDays: -2,
    perimenstrualWindowEndDays: 3,
    hormoneProfile: CycleHormoneProfile.UNKNOWN,
    updatedAt: null,
  };
}

export function CycleSettingsForm() {
  const t = useTranslations('CycleSettings');
  const [settings, setSettings] = useState<CycleSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const next = await fetchCycleSettings();
      setSettings(next);
    } catch {
      setError(t('load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react/exhaustive-deps
  }, []);

  const save = async (patch: Partial<CycleSettings>) => {
    try {
      setSaving(true);
      setError(null);
      const next = await updateCycleSettings(patch);
      setSettings(next);
    } catch {
      setError(t('save_error'));
    } finally {
      setSaving(false);
    }
  };

  const acceptedConsent = typeof window !== 'undefined'
    ? window.localStorage.getItem(CONSENT_STORAGE_KEY) === 'accepted'
    : false;

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t('enable_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('enable_hint')}</div>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={saving}
            onCheckedChange={async (enabled) => {
              if (enabled && !acceptedConsent) {
                setConsentOpen(true);
                return;
              }
              await save({ enabled });
            }}
          />
        </div>
      </div>

      {settings.enabled && (
        <>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t('include_exports_title')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('include_exports_hint')}</div>
              </div>
              <Switch
                checked={settings.includeInExports}
                disabled={saving}
                onCheckedChange={async includeInExports => save({ includeInExports })}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <label htmlFor="hormone-profile" className="text-sm font-medium">{t('hormone_profile')}</label>
            <select
              id="hormone-profile"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={settings.hormoneProfile}
              disabled={saving}
              onChange={async e => save({ hormoneProfile: e.target.value as CycleSettings['hormoneProfile'] })}
            >
              {Object.values(CycleHormoneProfile).map(option => (
                <option key={option} value={option}>{t(`hormone_options.${option}`)}</option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">{t('window_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('window_hint')}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="window-start" className="text-xs text-muted-foreground">{t('window_start')}</label>
                <select
                  id="window-start"
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
                  value={settings.perimenstrualWindowStartDays}
                  disabled={saving}
                  onChange={async (e) => {
                    await save({
                      perimenstrualWindowStartDays: Number(e.target.value),
                    });
                  }}
                >
                  {windowStartOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="window-end" className="text-xs text-muted-foreground">{t('window_end')}</label>
                <select
                  id="window-end"
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
                  value={settings.perimenstrualWindowEndDays}
                  disabled={saving}
                  onChange={async (e) => {
                    await save({
                      perimenstrualWindowEndDays: Number(e.target.value),
                    });
                  }}
                >
                  {windowEndOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link href="/dashboard/diary">{t('view_calendar')}</Link>
            </Button>
          </div>

          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="text-sm font-medium text-destructive">{t('danger_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('danger_hint')}</div>
            <Button
              variant="destructive"
              className="mt-3 min-h-11 w-full"
              disabled={saving}
              onClick={async () => {
                // eslint-disable-next-line no-alert
                if (!window.confirm(t('delete_confirm'))) {
                  return;
                }
                try {
                  setSaving(true);
                  await deleteAllCycleData();
                  setSettings(defaultSettings());
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t('delete_all')}
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <BottomSheet
        open={consentOpen}
        onOpenChange={setConsentOpen}
        title={t('consent_title')}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('consent_body')}</p>
          <div className="grid grid-cols-1 gap-2">
            <Button
              className="min-h-11"
              onClick={async () => {
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
                }
                setConsentOpen(false);
                await save({ enabled: true });
              }}
            >
              {t('consent_enable')}
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setConsentOpen(false)}>
              {t('consent_not_now')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
