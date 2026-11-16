'use client';

import type { AcuteDefaultTarget, ProgramDetailDTO, SleepDefaultTarget } from './programsApi';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { showSnackbar } from '@/features/snackbar';
import { MarkdownLite } from './MarkdownLite';
import {
  enrollInProgram,
  fetchProgramDetail,
} from './programsApi';

function isSleepTarget(t: SleepDefaultTarget | AcuteDefaultTarget): t is SleepDefaultTarget {
  return 'bedTime' in t;
}

export function ProgramDetailView({ programId }: { programId: string }) {
  const t = useTranslations('ProgramDetail');
  const locale = useLocale();
  const router = useRouter();
  const [detail, setDetail] = useState<ProgramDetailDTO | null>(null);
  const [bedTime, setBedTime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [acuteWindow, setAcuteWindow] = useState(30);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgramDetail(programId, locale)
      .then((d) => {
        setDetail(d);
        if (isSleepTarget(d.defaultTarget)) {
          setBedTime(d.defaultTarget.bedTime);
          setWakeTime(d.defaultTarget.wakeTime);
        } else {
          setAcuteWindow(d.defaultTarget.acuteWindowMinutes);
        }
      })
      .catch(() => setError(t('load_error')));
  }, [programId, t, locale]);

  if (error) {
    return <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
  }
  if (!detail) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  const enrolled = detail.activeEnrollment !== null;
  const isAcute = detail.shape === 'per-attack-rule';

  async function handleEnroll() {
    if (!detail) {
      return;
    }
    try {
      setEnrolling(true);
      const targetPayload: SleepDefaultTarget | AcuteDefaultTarget = isAcute
        ? { acuteWindowMinutes: acuteWindow }
        : {
            bedTime,
            wakeTime,
            toleranceMinutes: isSleepTarget(detail.defaultTarget)
              ? detail.defaultTarget.toleranceMinutes
              : 30,
          };
      await enrollInProgram(programId, targetPayload);
      showSnackbar({ message: t('enrolled_toast') });
      router.push(`/dashboard/programs/${programId}/progress`);
    } catch {
      showSnackbar({ message: t('enroll_failed_toast') });
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{detail.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail.shape === 'daily-habit' ? t('shape_daily_habit') : t('shape_per_attack')}
          {' · '}
          {t('weeks', { count: detail.durationWeeks })}
        </p>
      </header>

      <article className="rounded-2xl border bg-card p-4">
        <MarkdownLite source={detail.body} />
      </article>

      <div className="rounded-2xl border bg-card p-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('citations_label')}
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {detail.citations.map(c => (
            <li key={c.id}>
              {c.label}
              {c.doi ? ` · doi:${c.doi}` : ''}
              {c.pmid ? ` · PMID:${c.pmid}` : ''}
            </li>
          ))}
        </ul>
      </div>

      {!enrolled && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('target_label')}
          </div>
          {isAcute
            ? (
                <div className="mt-3">
                  <span className="text-xs text-muted-foreground">{t('acute_window_label')}</span>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={360}
                      value={acuteWindow}
                      onChange={e => setAcuteWindow(Math.max(1, Math.min(360, Number(e.target.value) || 30)))}
                      className="min-h-11 w-32"
                    />
                    <span className="text-sm text-muted-foreground">{t('minutes_after_onset')}</span>
                  </div>
                </div>
              )
            : (
                <>
                  <div className="mt-3 flex gap-3">
                    <label className="flex-1 text-xs">
                      <div className="mb-1 text-muted-foreground">{t('bed_time')}</div>
                      <Input
                        type="time"
                        value={bedTime}
                        onChange={e => setBedTime(e.target.value)}
                        className="min-h-11"
                      />
                    </label>
                    <label className="flex-1 text-xs">
                      <div className="mb-1 text-muted-foreground">{t('wake_time')}</div>
                      <Input
                        type="time"
                        value={wakeTime}
                        onChange={e => setWakeTime(e.target.value)}
                        className="min-h-11"
                      />
                    </label>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t('tolerance', {
                      minutes: isSleepTarget(detail.defaultTarget)
                        ? detail.defaultTarget.toleranceMinutes
                        : 30,
                    })}
                  </div>
                </>
              )}
        </div>
      )}

      {!enrolled
        ? (
            <div>
              <div
                role="note"
                className="flex items-start gap-3 rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
              >
                <span aria-hidden className="mt-0.5 text-lg leading-none">⚠</span>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide">
                    {t('disclaimer_label')}
                  </div>
                  <p className="mt-1 text-sm font-medium">{detail.disclaimer}</p>
                </div>
              </div>

              <Button
                className="mt-4 min-h-12 w-full"
                disabled={enrolling}
                onClick={handleEnroll}
              >
                {t('start_program')}
              </Button>
            </div>
          )
        : (
            <div className="space-y-3">
              <div className="rounded-2xl border bg-card p-4">
                <div className="text-xs text-muted-foreground">
                  {t('already_enrolled', { since: detail.activeEnrollment!.startDate })}
                  {detail.activeEnrollment!.status === 'paused' && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      {t('paused_badge')}
                    </span>
                  )}
                </div>
              </div>
              <Button asChild className="min-h-12 w-full">
                <Link href={`/dashboard/programs/${programId}/progress`}>{t('view_progress')}</Link>
              </Button>
            </div>
          )}
    </div>
  );
}
