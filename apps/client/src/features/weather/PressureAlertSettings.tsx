'use client';

import { Gauge, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import { PRESSURE_THRESHOLD_OPTIONS_HPA } from '@/services/pressure/pressureOutlook';

type Settings = { hasLocation: boolean; thresholdHpa: number | null };

const OFF = 'off';

type Props = {
  /** Bump to refetch, e.g. after the location form saves. */
  refreshKey?: number;
};

export function PressureAlertSettings({ refreshKey = 0 }: Props) {
  const t = useTranslations('PressureOutlook');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/user/pressure-alert');
      if (!res.ok) {
        throw new Error('load failed');
      }
      setSettings(await res.json());
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const onChange = async (value: string) => {
    const thresholdHpa = value === OFF ? null : Number(value);
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/user/pressure-alert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholdHpa }),
      });
      if (!res.ok) {
        throw new Error('save failed');
      }
      setSettings(await res.json());
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  // Keep a custom value (set via API) selectable instead of silently showing "Off".
  const options: number[] = [...PRESSURE_THRESHOLD_OPTIONS_HPA];
  if (settings?.thresholdHpa != null && !options.includes(settings.thresholdHpa)) {
    options.push(settings.thresholdHpa);
    options.sort((a, b) => a - b);
  }

  return (
    <section className="mt-8 border-t pt-6" aria-labelledby="pressure-alert-title">
      <div className="flex items-start gap-3">
        <Gauge className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 id="pressure-alert-title" className="text-lg font-semibold">{t('settings_title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings_description')}</p>

          {settings === null && status !== 'error' && (
            <Loader2 className="mt-4 size-5 animate-spin text-muted-foreground" />
          )}

          {settings && !settings.hasLocation && (
            <p className="mt-4 text-sm text-muted-foreground">{t('settings_no_location')}</p>
          )}

          {settings?.hasLocation && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Label htmlFor="pressure-threshold">{t('settings_label')}</Label>
              <select
                id="pressure-threshold"
                className="h-11 rounded-md border bg-background px-3 text-sm"
                value={settings.thresholdHpa === null ? OFF : String(settings.thresholdHpa)}
                onChange={e => onChange(e.target.value)}
                disabled={saving}
              >
                <option value={OFF}>{t('option_off')}</option>
                {options.map(v => (
                  <option key={v} value={String(v)}>{t('option_hpa', { value: v })}</option>
                ))}
              </select>
              {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              {status === 'saved' && (
                <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{t('settings_saved')}</span>
              )}
            </div>
          )}

          {status === 'error' && (
            <p role="alert" className="mt-3 text-sm text-destructive">{t('settings_error')}</p>
          )}

          {settings?.hasLocation && (
            <p className="mt-3 text-xs text-muted-foreground">{t('settings_push_hint')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
