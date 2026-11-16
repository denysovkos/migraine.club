'use client';

import type { DiaryTodayResponse } from './diaryApi';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { setLastAttackType } from '@/features/episodes/attackTypePrefs';
import { applyQueuedDiaryPatch, fetchTodayDiary, upsertDiaryEntry } from './diaryApi';

type ViewState
  = | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; data: DiaryTodayResponse; isSaving: boolean; saveError: string | null };

export function TodayCheckInCard() {
  const t = useTranslations('Diary');
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [showAttackCta, setShowAttackCta] = useState<null | { attackType: 'migraine' | 'headache' }>(null);
  const [startAttackToggle, setStartAttackToggle] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchTodayDiary()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setState({ kind: 'ready', data, isSaving: false, saveError: null });
      })
      .catch((err) => {
        if (!mounted) {
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : t('error_generic') });
      });
    return () => {
      mounted = false;
    };
  }, [t]);

  const title = t('today_title');

  const subtitle = useMemo(() => {
    if (state.kind !== 'ready') {
      return null;
    }
    const { timezone, todayLocalDate } = state.data;
    return DateTime.fromISO(todayLocalDate, { zone: timezone }).toLocaleString(DateTime.DATE_MED);
  }, [state]);

  const onQuickDayType = async (dayType: 'headache_free' | 'headache_day' | 'migraine_day') => {
    if (state.kind !== 'ready') {
      return;
    }
    const prev = state.data;
    setState({ kind: 'ready', data: prev, isSaving: true, saveError: null });
    setShowAttackCta(null);
    setStartAttackToggle(false);

    try {
      const saved = (await upsertDiaryEntry({
        localDate: prev.todayLocalDate,
        patch: { dayType },
      })) ?? applyQueuedDiaryPatch(prev.entry, prev.todayLocalDate, { dayType });
      setState({
        kind: 'ready',
        data: { ...prev, entry: saved },
        isSaving: false,
        saveError: null,
      });
      if (dayType === 'headache_day') {
        setShowAttackCta({ attackType: 'headache' });
      } else if (dayType === 'migraine_day') {
        setShowAttackCta({ attackType: 'migraine' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('error_generic');
      setState({ kind: 'ready', data: prev, isSaving: false, saveError: msg });
    }
  };

  const startAttackNow = async (attackType: 'migraine' | 'headache') => {
    if (state.kind !== 'ready') {
      return;
    }
    try {
      await fetch('/api/quick-add/episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackType }),
      });
      setLastAttackType(attackType);
      // Refresh today state after starting
      const data = await fetchTodayDiary();
      setState({ kind: 'ready', data, isSaving: false, saveError: null });
      setShowAttackCta(null);
      setStartAttackToggle(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('error_generic');
      setState(s => (s.kind === 'ready' ? { ...s, saveError: msg, isSaving: false } : s));
      setStartAttackToggle(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-muted-foreground">{title}</div>
          <div className="mt-1 text-base font-semibold">{subtitle ?? '—'}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/dashboard/diary">{t('open_diary')}</Link>
          </Button>
        </div>
      </div>

      {state.kind === 'loading' && (
        <div className="mt-4 h-12 animate-pulse rounded-lg bg-muted" />
      )}

      {state.kind === 'error' && (
        <div className="mt-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          {state.data.entry === null
            ? (
                <div className="mt-4">
                  <div className="text-sm text-muted-foreground">{t('today_question')}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      size="lg"
                      className="min-h-12"
                      variant="secondary"
                      disabled={state.isSaving}
                      onClick={() => onQuickDayType('headache_free')}
                    >
                      {t('no_head_pain')}
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      className="min-h-12"
                      disabled={state.isSaving}
                      onClick={() => onQuickDayType('headache_day')}
                    >
                      {t('headache')}
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      className="min-h-12"
                      disabled={state.isSaving}
                      onClick={() => onQuickDayType('migraine_day')}
                    >
                      {t('migraine')}
                    </Button>
                  </div>

                  {showAttackCta && (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">
                      <div className="text-muted-foreground">{t('add_attack_optional')}</div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {showAttackCta.attackType === 'migraine' ? t('will_start_attack_migraine') : t('will_start_attack_headache')}
                        </div>
                        <Switch
                          checked={startAttackToggle}
                          disabled={state.isSaving}
                          onCheckedChange={async (checked) => {
                            setStartAttackToggle(checked);
                            if (!checked) {
                              return;
                            }
                            await startAttackNow(showAttackCta.attackType);
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {state.saveError && (
                    <div className="mt-3 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                      {state.saveError}
                      {' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setState(s => s.kind === 'ready' ? { ...s, saveError: null } : s)}
                      >
                        {t('try_again')}
                      </button>
                    </div>
                  )}
                </div>
              )
            : (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      {t('recorded_label')}
                      {' '}
                      <span className="font-medium text-foreground">
                        {state.data.entry.dayType === 'headache_free'
                          ? t('recorded_headache_free')
                          : state.data.entry.dayType === 'headache_day'
                            ? t('recorded_headache_day')
                            : t('recorded_migraine_day')}
                      </span>
                      {state.data.entry.createdFrom === 'attack' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('recorded_from_attack')}
                        </span>
                      )}
                    </div>
                    <Button asChild variant="outline" size="sm" className="min-h-11">
                      <Link href={`/dashboard/diary?date=${encodeURIComponent(state.data.todayLocalDate)}`}>
                        {t('edit')}
                      </Link>
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('missing_not_good')}
                  </div>
                </div>
              )}
        </>
      )}
    </div>
  );
}
