'use client';

import type { PainReading, PainReadingError } from './painTimelineApi';
import type { PainLevel } from '@/utils/painLevel';
import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PainLevelPicker } from '@/components/PainLevelPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { attackWindow } from '@/services/episodes/painTimeline';
import { painLevelDisplay } from '@/utils/painLevel';
import { addPainReading, deletePainReading, fetchPainReadings } from './painTimelineApi';
import {
  buildChartModel,
  CHART_HEIGHT,
  CHART_PAD,
  CHART_WIDTH,
  defaultReadingTime,
  toDateTimeLocalValue,
} from './painTimelineChart';

export type PainTimelineProps = {
  episodeId: number;
  startTime: string | Date;
  onsetAt: string | Date | null;
  endTime: string | Date | null;
  isOngoing: boolean;
  /** Called with the attack's peak after a reading is added or deleted. */
  onPeakChange?: (peak: number) => void;
};

function browserTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function PainTimeline({ episodeId, startTime, onsetAt, endTime, isOngoing, onPeakChange }: PainTimelineProps) {
  const t = useTranslations('PainTimeline');
  const tLevel = useTranslations('painLevel');
  const locale = useLocale();

  const attack = useMemo(() => attackWindow({
    startTime: new Date(startTime),
    onsetAt: onsetAt ? new Date(onsetAt) : null,
    endTime: endTime ? new Date(endTime) : null,
    isOngoing,
  }), [startTime, onsetAt, endTime, isOngoing]);

  const [readings, setReadings] = useState<PainReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState<PainLevel | null>(null);
  const [when, setWhen] = useState(() => toDateTimeLocalValue(defaultReadingTime(attack.end, new Date())));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPainReadings(episodeId, { signal: controller.signal })
      .then(setReadings)
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [episodeId]);

  const model = useMemo(
    () => buildChartModel({ readings, start: attack.start, end: attack.end, now: new Date(), timezone: browserTimezone() }),
    [readings, attack],
  );

  const formatWhen = useCallback((date: Date) => date.toLocaleString(locale, model.spansMultipleDays
    ? { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }), [locale, model.spansMultipleDays]);

  const levelLabel = (value: number) => `${painLevelDisplay(value as PainLevel)} · ${tLevel(`level_${value}` as any)}`;

  const peak = readings.length > 0 ? Math.max(...readings.map(r => r.intensity)) : null;

  const handleAdd = async () => {
    if (level === null || saving) {
      return;
    }
    const picked = new Date(when);
    if (Number.isNaN(picked.getTime())) {
      setError(t('error_invalid_time'));
      return;
    }
    // The picker has minute precision: the onset minute itself means "at onset".
    const startMs = attack.start.getTime();
    const recordedAt = picked.getTime() < startMs && startMs - picked.getTime() < 60_000
      ? attack.start
      : picked;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addPainReading(episodeId, { intensity: level, recordedAt });
      if (result.queued) {
        setNotice(t('saved_offline'));
        setReadings(prev => [...prev, {
          id: `pending-${recordedAt.getTime()}`,
          episodeId,
          recordedAt: recordedAt.toISOString(),
          intensity: level,
        }]);
      } else {
        setReadings(prev => [...prev, result.reading]);
        onPeakChange?.(result.peakIntensity);
      }
      setLevel(null);
      setWhen(toDateTimeLocalValue(defaultReadingTime(attack.end, new Date())));
    } catch (e) {
      const reason = (e as PainReadingError).reason;
      setError(reason === 'before_start' || reason === 'after_end' || reason === 'in_future'
        ? t(`error_${reason}`)
        : t('save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reading: PainReading) => {
    setError(null);
    try {
      const peakAfter = await deletePainReading(episodeId, reading.id);
      setReadings(prev => prev.filter(r => r.id !== reading.id));
      if (peakAfter !== null) {
        onPeakChange?.(peakAfter);
      }
    } catch {
      setError(t('delete_error'));
    }
  };

  const linePath = model.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const shortTime = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const shortDay = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="pain-timeline-title" data-testid="pain-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 id="pain-timeline-title" className="text-sm font-medium">{t('title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        {peak !== null && (
          <span className="text-xs text-muted-foreground" data-testid="pain-timeline-peak">
            {t('peak', { level: levelLabel(peak) })}
          </span>
        )}
      </div>

      {loading
        ? <p className="text-sm text-muted-foreground">{t('loading')}</p>
        : loadFailed
          ? <p role="alert" className="text-sm text-destructive">{t('load_error')}</p>
          : readings.length === 0
            ? <p className="text-sm text-muted-foreground">{t('empty')}</p>
            : (
                <figure className="m-0">
                  <svg
                    viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                    className="h-auto w-full text-foreground"
                    role="img"
                    aria-label={t('chart_label', { count: readings.length, peak: levelLabel(peak!) })}
                  >
                    {model.levels.map(l => (
                      <g key={l.level}>
                        <line x1={CHART_PAD.left} x2={CHART_WIDTH - CHART_PAD.right} y1={l.y} y2={l.y} stroke="currentColor" strokeOpacity={0.1} />
                        <text x={CHART_PAD.left - 6} y={l.y + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                          {painLevelDisplay(l.level as PainLevel)}
                        </text>
                      </g>
                    ))}
                    {model.midnights.map(m => (
                      <g key={m.at.toISOString()} data-testid="pain-timeline-midnight">
                        <line x1={m.x} x2={m.x} y1={CHART_PAD.top} y2={CHART_HEIGHT - CHART_PAD.bottom} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
                        <text x={m.x + 2} y={CHART_PAD.top - 2} fontSize={8} fill="currentColor" fillOpacity={0.6}>{shortDay(m.at)}</text>
                      </g>
                    ))}
                    <path d={linePath} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />
                    {model.points.map(p => (
                      <circle key={p.id} cx={p.x} cy={p.y} r={3.5} className="fill-primary" />
                    ))}
                    <text x={CHART_PAD.left} y={CHART_HEIGHT - 6} fontSize={9} fill="currentColor" fillOpacity={0.6}>
                      {shortTime(model.start)}
                    </text>
                    <text x={CHART_WIDTH - CHART_PAD.right} y={CHART_HEIGHT - 6} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                      {attack.end ? shortTime(model.end) : t('now')}
                    </text>
                  </svg>
                </figure>
              )}

      {readings.length > 0 && (
        <ul className="divide-y rounded-md border text-sm" aria-label={t('readings_label')}>
          {model.points.map((p) => {
            const reading = readings.find(r => r.id === p.id)!;
            const pending = reading.id.startsWith('pending-');
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="pain-reading-row">
                <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{formatWhen(p.recordedAt)}</span>
                <span className="min-w-0 flex-1 text-right font-medium">{levelLabel(p.intensity)}</span>
                {!pending && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-11 min-w-11"
                    aria-label={t('delete_aria', { time: formatWhen(p.recordedAt) })}
                    onClick={() => handleDelete(reading)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3 border-t pt-4">
        <div className="text-sm font-medium">{t('add_title')}</div>
        <PainLevelPicker value={level} onChange={setLevel} size="md" disabled={saving} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="pain-reading-time">{t('time_label')}</Label>
            <Input
              id="pain-reading-time"
              type="datetime-local"
              value={when}
              min={toDateTimeLocalValue(attack.start)}
              max={attack.end ? toDateTimeLocalValue(attack.end) : undefined}
              onChange={e => setWhen(e.target.value)}
              disabled={saving}
              className="min-h-11"
            />
          </div>
          <Button type="button" className="min-h-11" onClick={handleAdd} disabled={level === null || saving}>
            {saving ? t('saving') : t('add_button')}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      </div>
    </section>
  );
}
