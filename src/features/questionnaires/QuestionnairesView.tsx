'use client';

import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QuestionnaireType } from '@/services/questionnaires/scoring';

type QuestionnaireResponse = {
  id: string;
  type: 'HIT6' | 'MIDAS' | 'MSQ21';
  takenAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  answers: any;
  scoreTotal: number | null;
  scoreDetails: any | null;
};

type ListResponse = { responses: QuestionnaireResponse[] };

const HIT6_QUESTIONS = [
  'When you have headaches, how often is the pain severe?',
  'How often do headaches limit your ability to do usual daily activities?',
  'When you have headaches, how often do you wish you could lie down?',
  'In the past 4 weeks, how often have you felt too tired to do work or daily activities because of headaches?',
  'In the past 4 weeks, how often have you felt fed up or irritated because of headaches?',
  'In the past 4 weeks, how often did headaches limit your ability to concentrate?',
] as const;

const HIT6_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'NEVER', label: 'Never' },
  { value: 'RARELY', label: 'Rarely' },
  { value: 'SOMETIMES', label: 'Sometimes' },
  { value: 'VERY_OFTEN', label: 'Very often' },
  { value: 'ALWAYS', label: 'Always' },
];

const MIDAS_QUESTIONS = [
  'In the last 3 months, how many days did you miss work or school because of headaches?',
  'In the last 3 months, how many days was your productivity at work or school reduced by half or more because of headaches (excluding days missed)?',
  'In the last 3 months, how many days did you not do household work because of headaches?',
  'In the last 3 months, how many days was your productivity in household work reduced by half or more because of headaches (excluding days you did not do household work)?',
  'In the last 3 months, how many days did you miss family, social, or leisure activities because of headaches?',
] as const;

function msqDomainForQuestionNumber(n: number): string {
  if (n >= 1 && n <= 7) {
    return 'Restrictive';
  }
  if (n >= 8 && n <= 11) {
    return 'Preventive';
  }
  return 'Emotional';
}

function formatShortDate(iso: string): string {
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toLocaleString(DateTime.DATE_MED) : iso;
}

export function QuestionnairesView() {
  const t = useTranslations('Questionnaires');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hit6, setHit6] = useState<QuestionnaireResponse[]>([]);
  const [midas, setMidas] = useState<QuestionnaireResponse[]>([]);
  const [msq, setMsq] = useState<QuestionnaireResponse[]>([]);

  const [open, setOpen] = useState<'HIT6' | 'MIDAS' | 'MSQ21' | null>(null);

  // Form state
  const [hit6Answers, setHit6Answers] = useState<Record<string, string>>({});
  const [midasAnswers, setMidasAnswers] = useState<Record<string, number>>({});
  const [msqAnswers, setMsqAnswers] = useState<Record<string, number>>({});
  const [showMsq, setShowMsq] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, m, s] = await Promise.all([
        fetch('/api/questionnaires?type=HIT6&limit=50'),
        fetch('/api/questionnaires?type=MIDAS&limit=50'),
        fetch('/api/questionnaires?type=MSQ21&limit=50'),
      ]);
      if (!h.ok || !m.ok || !s.ok) {
        throw new Error(t('load_error'));
      }
      const hj = (await h.json()) as ListResponse;
      const mj = (await m.json()) as ListResponse;
      const sj = (await s.json()) as ListResponse;
      setHit6(hj.responses);
      setMidas(mj.responses);
      setMsq(sj.responses);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react/exhaustive-deps
  }, []);

  const latestHit6 = hit6[0] ?? null;
  const latestMidas = midas[0] ?? null;
  const latestMsq = msq[0] ?? null;

  const hit6Trend = useMemo(() => hit6
    .slice()
    .reverse()
    .map(r => ({
      x: formatShortDate(r.takenAt),
      score: r.scoreTotal ?? 0,
    })), [hit6]);

  const midasTrend = useMemo(() => midas
    .slice()
    .reverse()
    .map(r => ({
      x: formatShortDate(r.takenAt),
      score: r.scoreTotal ?? 0,
    })), [midas]);

  const msqTrend = useMemo(() => msq
    .slice()
    .reverse()
    .map(r => ({
      x: formatShortDate(r.takenAt),
      total: r.scoreDetails?.domains?.total ?? (r.scoreTotal ?? 0),
      restrictive: r.scoreDetails?.domains?.restrictive ?? null,
      preventive: r.scoreDetails?.domains?.preventive ?? null,
      emotional: r.scoreDetails?.domains?.emotional ?? null,
    })), [msq]);

  const submit = async (type: 'HIT6' | 'MIDAS' | 'MSQ21') => {
    setSubmitting(true);
    setError(null);
    try {
      let answers: any;
      if (type === 'HIT6') {
        answers = {
          q1: hit6Answers.q1,
          q2: hit6Answers.q2,
          q3: hit6Answers.q3,
          q4: hit6Answers.q4,
          q5: hit6Answers.q5,
          q6: hit6Answers.q6,
        };
      } else if (type === 'MIDAS') {
        answers = {
          q1: Number(midasAnswers.q1 ?? 0),
          q2: Number(midasAnswers.q2 ?? 0),
          q3: Number(midasAnswers.q3 ?? 0),
          q4: Number(midasAnswers.q4 ?? 0),
          q5: Number(midasAnswers.q5 ?? 0),
        };
      } else {
        answers = Object.fromEntries(
          Array.from({ length: 14 }, (_, i) => {
            const k = `q${i + 1}`;
            return [k, Number(msqAnswers[k] ?? 1)];
          }),
        );
      }

      const res = await fetch('/api/questionnaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, answers }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || t('submit_error'));
      }
      await load();
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('submit_error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* HIT-6 */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">HIT-6</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('hit6_subtitle')}</div>
            </div>
            <Badge variant="secondary">{t('validated')}</Badge>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {latestHit6
              ? t('last_taken', { date: formatShortDate(latestHit6.takenAt), score: latestHit6.scoreTotal ?? '-' })
              : t('not_taken_yet')}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setOpen(open === 'HIT6' ? null : 'HIT6')}>
              {t('take_now')}
            </Button>
          </div>

          {hit6Trend.length >= 2 && (
            <div className="mt-4 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hit6Trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} domain={[36, 78]} />
                  <RechartsTooltip />
                  <Line type="monotone" dataKey="score" stroke="hsl(234, 100%, 71%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-2 text-xs text-muted-foreground">
            {latestHit6 ? t('hit6_summary', { score: latestHit6.scoreTotal ?? '-' }) : t('hit6_summary_empty')}
          </div>

          {open === 'HIT6' && (
            <div className="mt-4 space-y-3">
              {HIT6_QUESTIONS.map((q, idx) => {
                const key = `q${idx + 1}`;
                return (
                  <div key={key} className="space-y-1">
                    <div className="text-xs font-medium">
                      {idx + 1}
                      .
                      {' '}
                      {q}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {HIT6_CHOICES.map(c => (
                        <Button
                          key={c.value}
                          type="button"
                          size="sm"
                          variant={hit6Answers[key] === c.value ? 'default' : 'outline'}
                          onClick={() => setHit6Answers(prev => ({ ...prev, [key]: c.value }))}
                        >
                          {c.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                onClick={() => submit(QuestionnaireType.HIT6)}
                disabled={submitting}
              >
                {submitting ? t('submitting') : t('save')}
              </Button>
            </div>
          )}
        </div>

        {/* MIDAS */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">MIDAS</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('midas_subtitle')}</div>
            </div>
            <Badge variant="secondary">{t('validated')}</Badge>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {latestMidas
              ? t('last_taken', { date: formatShortDate(latestMidas.takenAt), score: latestMidas.scoreTotal ?? '-' })
              : t('not_taken_yet')}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setOpen(open === 'MIDAS' ? null : 'MIDAS')}>
              {t('take_now')}
            </Button>
          </div>

          {midasTrend.length >= 2 && (
            <div className="mt-4 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={midasTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <RechartsTooltip />
                  <Line type="monotone" dataKey="score" stroke="hsl(346, 77%, 60%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-2 text-xs text-muted-foreground">
            {latestMidas
              ? t('midas_summary', {
                  score: latestMidas.scoreTotal ?? '-',
                  grade: latestMidas.scoreDetails?.grade ?? '-',
                })
              : t('midas_summary_empty')}
          </div>

          {open === 'MIDAS' && (
            <div className="mt-4 space-y-3">
              <div className="text-xs text-muted-foreground">{t('midas_cadence')}</div>
              {MIDAS_QUESTIONS.map((q, idx) => {
                const key = `q${idx + 1}`;
                return (
                  <div key={key} className="space-y-1">
                    <div className="text-xs font-medium">
                      {idx + 1}
                      .
                      {' '}
                      {q}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={String(midasAnswers[key] ?? 0)}
                      onChange={e => setMidasAnswers(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                      className="w-28"
                    />
                  </div>
                );
              })}
              <Button
                type="button"
                onClick={() => submit(QuestionnaireType.MIDAS)}
                disabled={submitting}
              >
                {submitting ? t('submitting') : t('save')}
              </Button>
            </div>
          )}
        </div>

        {/* MSQ v2.1 (optional) */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">MSQ v2.1</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('msq_subtitle')}</div>
            </div>
            <Badge variant="outline">{t('optional')}</Badge>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {latestMsq
              ? t('last_taken', { date: formatShortDate(latestMsq.takenAt), score: latestMsq.scoreTotal ?? '-' })
              : t('not_taken_yet')}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowMsq(v => !v)}>
              {showMsq ? t('hide') : t('show_advanced')}
            </Button>
            {showMsq && (
              <Button size="sm" onClick={() => setOpen(open === 'MSQ21' ? null : 'MSQ21')}>
                {t('take_now')}
              </Button>
            )}
          </div>

          {msqTrend.length >= 2 && (
            <div className="mt-4 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={msqTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <RechartsTooltip />
                  <Line type="monotone" dataKey="total" stroke="hsl(204, 94%, 68%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-2 text-xs text-muted-foreground">
            {latestMsq ? t('msq_summary', { score: latestMsq.scoreTotal ?? '-' }) : t('msq_summary_empty')}
          </div>

          {showMsq && open === 'MSQ21' && (
            <div className="mt-4 space-y-3">
              <div className="text-xs text-muted-foreground">{t('msq_time')}</div>
              <div className="text-xs text-muted-foreground">
                {t('msq_q_number_note')}
              </div>
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{t('msq_about_title')}</div>
                <div className="mt-1 space-y-1">
                  <div>{t('msq_copyright_note')}</div>
                  <div>
                    {t('msq_get_official_prefix')}
                    {' '}
                    <a
                      href="https://eprovide.mapi-trust.org/"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      {t('msq_get_official_link_label')}
                    </a>
                    .
                    {' '}
                    {t('msq_get_official_suffix')}
                  </div>
                  <div className="mt-2 font-medium text-foreground">{t('msq_blueprint_title')}</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>{t('msq_blueprint_rfr')}</li>
                    <li>{t('msq_blueprint_rfp')}</li>
                    <li>{t('msq_blueprint_ef')}</li>
                  </ul>
                </div>
              </div>
              {Array.from({ length: 14 }, (_, i) => {
                const key = `q${i + 1}`;
                const n = i + 1;
                const domain = msqDomainForQuestionNumber(n);
                return (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium">
                      {`Q${n} (${domain})`}
                    </div>
                    <select
                      value={String(msqAnswers[key] ?? 1)}
                      onChange={e => setMsqAnswers(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                      className="flex h-9 w-28 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                      <option value="6">6</option>
                    </select>
                  </div>
                );
              })}
              <Button
                type="button"
                onClick={() => submit(QuestionnaireType.MSQ21)}
                disabled={submitting}
              >
                {submitting ? t('submitting') : t('save')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
