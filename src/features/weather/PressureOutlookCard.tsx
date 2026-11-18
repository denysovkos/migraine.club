'use client';

import type { PressureOutlook } from '@/services/pressure/PressureForecastService';
import { ArrowDown, ArrowUp, Gauge, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { formatChange, weekdayLabel } from './pressureFormat';

type State
  = | { kind: 'loading' }
    | { kind: 'hidden' }
    | { kind: 'error' }
    | { kind: 'ready'; outlook: PressureOutlook };

/**
 * Multi-day pressure outlook. Shows day-over-day change and marks days whose
 * fall meets the user's threshold. Framed as context, not attack prediction.
 */
export function PressureOutlookCard() {
  const t = useTranslations('PressureOutlook');
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/weather/pressure-outlook');
        if (res.status === 404) {
          // No location yet: the Weather Pain card already prompts for it.
          if (!cancelled) {
            setState({ kind: 'hidden' });
          }
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to load pressure outlook');
        }
        const outlook: PressureOutlook = await res.json();
        if (!cancelled) {
          setState({ kind: 'ready', outlook });
        }
      } catch {
        if (!cancelled) {
          setState({ kind: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'hidden') {
    return null;
  }

  if (state.kind === 'loading') {
    return (
      <section className="mc-card" aria-busy="true">
        <div className="animate-pulse">
          <div className="mb-3 h-5 w-40 rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
          <div className="h-24 w-full rounded" style={{ background: 'var(--mc-bg-subtle)' }} />
        </div>
      </section>
    );
  }

  const outlook = state.kind === 'ready' ? state.outlook : null;
  const days = outlook?.days ?? [];

  return (
    <section className="mc-card" aria-labelledby="pressure-outlook-title" data-testid="pressure-outlook">
      <div className="mb-3 flex items-start gap-2">
        <Gauge className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} style={{ color: 'var(--mc-fg-2)' }} />
        <div className="min-w-0">
          <h3 id="pressure-outlook-title" className="text-[15px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {t('title')}
          </h3>
          {days.length > 0 && (
            <div className="text-[11.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
              {t('subtitle', { count: days.length })}
            </div>
          )}
        </div>
      </div>

      {days.length === 0
        ? (
            <p className="text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>{t('unavailable')}</p>
          )
        : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {days.map((day, i) => {
                const change = day.changeHpa;
                const Icon = change === null || Math.abs(change) < 0.5 ? Minus : change < 0 ? ArrowDown : ArrowUp;
                return (
                  <li
                    key={day.date}
                    data-testid={`pressure-day-${day.date}`}
                    data-drop={day.dropAtOrAboveThreshold ? 'true' : 'false'}
                    className="rounded-xl border px-2.5 py-2"
                    style={{
                      borderColor: day.dropAtOrAboveThreshold ? 'var(--mc-warn-fg)' : 'var(--mc-border)',
                      background: day.dropAtOrAboveThreshold ? 'var(--mc-warn-bg)' : 'transparent',
                    }}
                  >
                    <div className="text-[11.5px] font-semibold" style={{ color: 'var(--mc-fg-2)' }}>
                      {i === 0 ? t('today') : weekdayLabel(day.date, locale)}
                    </div>
                    <div className="mc-tnum text-[15px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
                      {Math.round(day.pressureHpa)}
                    </div>
                    <div className="mc-tnum flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--mc-fg-muted)' }}>
                      <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
                      <span>{change === null ? '–' : formatChange(change)}</span>
                    </div>
                    {day.dropAtOrAboveThreshold && (
                      <div className="mt-1 text-[10.5px] font-semibold leading-tight" style={{ color: 'var(--mc-warn-fg)' }}>
                        {t('drop_badge', { threshold: outlook!.highlightThresholdHpa })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

      <p className="mt-3 text-[11.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
        {t('context_note')}
      </p>

      {outlook && (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
          <span style={{ color: 'var(--mc-fg-2)' }}>
            {outlook.alertThresholdHpa !== null
              ? t('alert_on', { threshold: outlook.alertThresholdHpa })
              : t('alert_off')}
          </span>
          <Link
            href="/dashboard/settings/location"
            className="mc-ring font-semibold"
            style={{ color: 'var(--mc-brand-press)' }}
          >
            {t('manage_link')}
          </Link>
        </div>
      )}
    </section>
  );
}
