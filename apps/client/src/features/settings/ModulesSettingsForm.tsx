'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { fetchCycleSettings, updateCycleSettings } from '@/features/cycle/cycleApi';
import { fetchProgramSettings, updateProgramSettings } from '@/features/programs/programsApi';

export function ModulesSettingsForm() {
  const t = useTranslations('ModulesSettings');
  const [loading, setLoading] = useState(true);
  const [savingCycle, setSavingCycle] = useState(false);
  const [savingPrograms, setSavingPrograms] = useState(false);
  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [programsEnabled, setProgramsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchCycleSettings().catch(() => null), fetchProgramSettings().catch(() => null)])
      .then(([cycle, programs]) => {
        if (!mounted) {
          return;
        }
        if (cycle) {
          setCycleEnabled(cycle.enabled);
        }
        if (programs) {
          setProgramsEnabled(programs.enabled);
        }
        if (!cycle && !programs) {
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
            <div className="text-sm font-medium">{t('cycle_module_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('cycle_module_hint')}</div>
          </div>
          <Switch
            checked={cycleEnabled}
            disabled={savingCycle}
            onCheckedChange={async (enabled) => {
              try {
                setSavingCycle(true);
                setError(null);
                await updateCycleSettings({ enabled });
                setCycleEnabled(enabled);
              } catch {
                setError(t('save_error'));
              } finally {
                setSavingCycle(false);
              }
            }}
          />
        </div>
        <div className="mt-3">
          <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
            <Link href="/dashboard/settings/cycle">{t('cycle_module_configure')}</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t('programs_module_title')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('programs_module_hint')}</div>
          </div>
          <Switch
            checked={programsEnabled}
            disabled={savingPrograms}
            onCheckedChange={async (enabled) => {
              try {
                setSavingPrograms(true);
                setError(null);
                await updateProgramSettings({ enabled });
                setProgramsEnabled(enabled);
              } catch {
                setError(t('save_error'));
              } finally {
                setSavingPrograms(false);
              }
            }}
          />
        </div>
        <div className="mt-3">
          <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
            <Link href="/dashboard/settings/programs">{t('programs_module_configure')}</Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
