'use client';

import type { FactorOptionsResponse } from './factorsApi';
import { useTranslations } from 'next-intl';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

import { showSnackbar } from '@/features/snackbar';
import { fetchFactorOptions, logFactorEvent } from './factorsApi';

const FALLBACK_FETCH_ERROR = 'Failed to load factor options';
const FALLBACK_SAVE_ERROR = 'Failed to log factor';

export function FactorLoggerCard(props: {
  localDate?: string;
  titleKey?: string;
  onDidLog?: () => void;
}) {
  const t = useTranslations('Factors' as never) as (key: string) => string;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FactorOptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isMountedRef = useRef(true);
  const isSavingRef = useRef(false);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setData(null);
    setError(null);

    fetchFactorOptions(props.localDate)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setData(result);
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : FALLBACK_FETCH_ERROR);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.localDate]);

  async function logBuiltIn(type: 'trigger' | 'protector', key: string) {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setSaving(true);
    setError(null);

    try {
      await logFactorEvent({ displayName: key, type, localDate: props.localDate });
      if (!isMountedRef.current) {
        return;
      }
      props.onDidLog?.();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : FALLBACK_SAVE_ERROR;
      if (!isMountedRef.current) {
        return;
      }
      setError(message);
      showSnackbar({ message });
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/40">
      <div className="text-base font-semibold">{t(props.titleKey ?? 'card_title')}</div>
      {loading && (
        <div className="mt-3 h-11 w-full animate-pulse rounded-xl bg-muted" aria-label={t('loading')} />
      )}
      {!loading && error && (
        <div className="mt-3 rounded-xl bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {data?.trigger.builtIns.map(item => (
          <Button
            key={item.key}
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => logBuiltIn('trigger', item.key)}
          >
            {t(item.translationKey)}
          </Button>
        ))}
        {data?.protector.builtIns.map(item => (
          <Button
            key={item.key}
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => logBuiltIn('protector', item.key)}
          >
            {t(item.translationKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
