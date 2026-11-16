'use client';

import type { AppointmentPrepSnapshot } from '@/models/appointmentPrep';
import type { SupportedLanguageType } from '@/models/Schema';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Globe,
  Lock,
  Pill,
  Shield,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PainLevelBadge } from '@/components/PainLevelBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppConfig } from '@/utils/AppConfig';
import { normalizeToPainLevel, painLevelDisplay } from '@/utils/painLevel';

import { useShareLocale } from './ShareIntlProvider';

/**
 * Shared episode type - matches API response (excludes sensitive fields)
 */
type SharedEpisode = {
  id: number;
  attackType: 'migraine' | 'headache';
  startTime: string;
  endTime: string | null;
  isOngoing: boolean;
  intensity: number | null;
  painLocation: string;
  painLocationOther: string | null;
  painType: string;
  painTypeOther: string | null;
  symptoms: string[];
  symptomsOther: string | null;
  medicationIntakes: Array<{ label: string; dose: string | null; unit: string | null; takenAt: string }>;
  triggers: string[];
  triggersOther: string | null;
  notes: string | null;
  weatherContext: {
    wpiScore: number;
    wpiLevel: string;
    kpIndex: number | null;
    deltaPressure: number;
    humidity: number;
  } | null;
};

type ShareData = {
  patientDisplayName: string;
  recipientName: string | null;
  expiresAt: string;
  patientPreferredLanguage: SupportedLanguageType;
  appointmentPrep: {
    appointmentDate: string;
    visitLabel: string | null;
    clinicianName: string | null;
    visitReason: string | null;
    topConcerns: string[];
    doctorQuestions: string[];
    personalNotes: string | null;
    generatedSnapshot: AppointmentPrepSnapshot;
  } | null;
  dateRange: {
    start: string | null;
    end: string | null;
  };
  summary: {
    totalEpisodes: number;
    episodesThisMonth: number;
    averageIntensity: number;
    averageDurationMinutes: number | null;
    mostCommonTrigger: string | null;
    mostCommonSymptom: string | null;
    mostCommonMedication: string | null;
    weeklyTrend: Array<{ week: string; count: number; avgIntensity: number }>;
  };
  episodes: SharedEpisode[];
  doctorGrade?: {
    outcomes: {
      last28: any;
      last90: any;
      monthly: any;
    };
    medicationSummary: Array<{
      name: string;
      uses: number;
    }>;
    questionnaires: {
      hit6: any[];
      midas: any[];
      msq21: any[];
    };
  };
};

type ErrorInfo = {
  message: string;
  code: string;
};

type AppointmentPrepMessageKey
  = | 'coverage_summary'
    | 'attack_summary'
    | 'treatment_adjustment'
    | 'acute_medication_safety';

function isAppointmentPrepMessageKey(value: string): value is AppointmentPrepMessageKey {
  return [
    'coverage_summary',
    'attack_summary',
    'treatment_adjustment',
    'acute_medication_safety',
  ].includes(value);
}

function renderAppointmentPrepMessage(
  key: string,
  t: (messageKey: string) => string,
) {
  if (!isAppointmentPrepMessageKey(key)) {
    return key;
  }

  return t(key);
}

export function ShareReportView({ token }: { token: string }) {
  const t = useTranslations('ShareReport');
  const tPrep = useTranslations('AppointmentPrep' as never) as (messageKey: string) => string;
  const { locale, setLocale } = useShareLocale();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/share/${token}`);
        const result = await response.json();

        if (!response.ok) {
          setError({ message: result.error, code: result.code });
          return;
        }

        setData(result);

        // Set locale to patient's preferred language
        if (result.patientPreferredLanguage) {
          setLocale(result.patientPreferredLanguage);
        }
      } catch {
        setError({ message: 'Failed to load report', code: 'NETWORK_ERROR' });
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [token, setLocale]);

  // End session handler
  const handleEndSession = () => {
    setSessionEnded(true);
    setData(null);
  };

  if (loading) {
    return <LoadingState t={t} />;
  }

  if (sessionEnded) {
    return <SessionEndedState t={t} />;
  }

  if (error) {
    return <ErrorState error={error} t={t} />;
  }

  if (!data) {
    return <ErrorState error={{ message: 'No data available', code: 'NO_DATA' }} t={t} />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <ReportHeader
        patientName={data.patientDisplayName}
        recipientName={data.recipientName}
        expiresAt={data.expiresAt}
        onEndSession={handleEndSession}
        currentLocale={locale}
        onLocaleChange={setLocale}
        t={t}
      />

      {/* Navigation tabs */}
      <nav className="sticky top-0 z-10 mb-6 rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex w-full gap-2 overflow-x-auto pb-1">
          {data.appointmentPrep
            ? (
                <a
                  href="#appointment-prep"
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  {tPrep('title')}
                </a>
              )
            : null}
          <a
            href="#summary"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            {t('summary_title')}
          </a>
          <a
            href="#outcomes"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            {t('doctor_grade_outcomes_title')}
          </a>
          <a
            href="#questionnaires"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            {t('questionnaires_title')}
          </a>
          <a
            href="#episodes"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            {t('episodes_title')}
          </a>
        </div>
      </nav>

      {data.appointmentPrep
        ? (
            <section id="appointment-prep" className="mb-8 scroll-mt-20">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <Calendar className="size-5" />
                {tPrep('title')}
              </h2>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{tPrep('appointment_date')}</div>
                    <div className="mt-1 font-medium text-slate-800">{data.appointmentPrep.appointmentDate}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{tPrep('visit_label')}</div>
                    <div className="mt-1 font-medium text-slate-800">
                      {data.appointmentPrep.visitLabel || tPrep('untitled_visit')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{tPrep('clinician_name')}</div>
                    <div className="mt-1 font-medium text-slate-800">
                      {data.appointmentPrep.clinicianName || tPrep('none')}
                    </div>
                  </div>
                </div>

                {data.appointmentPrep.visitReason
                  ? (
                      <div className="mt-4">
                        <div className="text-sm font-medium text-slate-800">{tPrep('visit_reason')}</div>
                        <p className="mt-1 text-sm text-slate-700">{data.appointmentPrep.visitReason}</p>
                      </div>
                    )
                  : null}

                {data.appointmentPrep.topConcerns.length > 0
                  ? (
                      <div className="mt-4">
                        <div className="text-sm font-medium text-slate-800">{tPrep('top_concerns')}</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                          {data.appointmentPrep.topConcerns.map(item => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )
                  : null}

                {data.appointmentPrep.generatedSnapshot.whatChangedKeys.length > 0
                  ? (
                      <div className="mt-4">
                        <div className="text-sm font-medium text-slate-800">{tPrep('what_changed')}</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                          {data.appointmentPrep.generatedSnapshot.whatChangedKeys.map(key => (
                            <li key={key}>{renderAppointmentPrepMessage(key, tPrep)}</li>
                          ))}
                        </ul>
                      </div>
                    )
                  : null}

                {data.appointmentPrep.doctorQuestions.length > 0
                  ? (
                      <div className="mt-4">
                        <div className="text-sm font-medium text-slate-800">{tPrep('doctor_questions')}</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                          {data.appointmentPrep.doctorQuestions.map(item => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )
                  : null}
              </div>
            </section>
          )
        : null}

      {/* Summary Section */}
      <section id="summary" className="mb-8 scroll-mt-20">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <TrendingUp className="size-5" />
          {t('summary_title')}
        </h2>
        <SummarySection
          summary={data.summary}
          dateRange={data.dateRange}
          t={t}
        />
      </section>

      {/* Doctor-grade outcomes */}
      <section id="outcomes" className="mb-8 scroll-mt-20">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <TrendingUp className="size-5" />
          {t('doctor_grade_outcomes_title')}
        </h2>
        <DoctorGradeSection doctorGrade={data.doctorGrade} t={t} />
      </section>

      {/* Questionnaires */}
      <section id="questionnaires" className="mb-8 scroll-mt-20">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <FileText className="size-5" />
          {t('questionnaires_title')}
        </h2>
        <DoctorGradeQuestionnairesSection doctorGrade={data.doctorGrade} t={t} />
      </section>

      {/* Episodes Section */}
      <section id="episodes" className="scroll-mt-20">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <FileText className="size-5" />
          {t('episodes_title')}
        </h2>
        <EpisodesList episodes={data.episodes} t={t} />
      </section>

      {/* Footer disclaimer */}
      <footer className="mt-8 rounded-lg bg-slate-100 p-4 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center gap-2">
          <Shield className="size-4" />
          <span>{t('confidential_health_data')}</span>
        </div>
        <p className="mt-1">
          {data.recipientName ? t('for_recipient', { recipient: data.recipientName }) : ''}
          {t('read_only_data')}
        </p>
        <p className="mt-1">
          {t('link_expires')}
          {' '}
          {new Date(data.expiresAt).toLocaleDateString()}
        </p>
        <p className="mt-2">
          {t('doctor_report_disclaimer')}
        </p>
      </footer>
    </div>
  );
}

function DoctorGradeSection({
  doctorGrade,
  t,
}: {
  doctorGrade: ShareData['doctorGrade'] | undefined;
  t: ReturnType<typeof useTranslations<'ShareReport'>>;
}) {
  if (!doctorGrade) {
    return (
      <div className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600">
        {t('doctor_grade_not_available')}
      </div>
    );
  }

  const last28 = doctorGrade.outcomes.last28;
  const last90 = doctorGrade.outcomes.last90;
  const monthly = doctorGrade.outcomes.monthly?.months ?? [];

  const responder = last28?.responder50?.status ?? null;
  const responderLabel = responder
    ? ({
        YES: t('responder_yes'),
        NO: t('responder_no'),
        NA: (last28?.responder50 as any)?.reason === 'INSUFFICIENT_COVERAGE'
          ? t('responder_insufficient_coverage')
          : t('responder_na'),
      } as any)[responder] ?? responder
    : t('responder_not_configured');

  function fmtRange(min: number | undefined, max: number | undefined): string {
    const a = typeof min === 'number' ? min : 0;
    const b = typeof max === 'number' ? max : a;
    return a === b ? String(a) : `${a}–${b}`;
  }

  const chartData = monthly.map((m: any) => ({
    month: m.month,
    mmd: m.mmd,
    mhd: m.mhd,
    meds: m.acuteMedicationDays,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-slate-700">{t('last_28_days')}</div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <StatCard label="MMD" value={fmtRange((last28 as any)?.totals?.mmdMin, (last28 as any)?.totals?.mmdMax)} />
            <StatCard label="MHD" value={fmtRange((last28 as any)?.totals?.mhdMin, (last28 as any)?.totals?.mhdMax)} />
            <StatCard label={t('med_days_short')} value={String(last28?.totals?.acuteMedicationDays ?? 0)} />
          </div>
          {(last28 as any)?.totals?.coverage && (
            <div className="mt-2 text-xs text-slate-500">
              {t('coverage', {
                recorded: (last28 as any).totals.coverage.recordedDays,
                total: (last28 as any).totals.coverage.totalDays,
                missing: (last28 as any).totals.coverage.missingDays,
              })}
            </div>
          )}
          <div className="mt-3 text-xs text-slate-500">
            {t('responder_title')}
            :
            {' '}
            {responderLabel}
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-slate-700">{t('last_90_days')}</div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <StatCard label="MMD" value={fmtRange((last90 as any)?.totals?.mmdMin, (last90 as any)?.totals?.mmdMax)} />
            <StatCard label="MHD" value={fmtRange((last90 as any)?.totals?.mhdMin, (last90 as any)?.totals?.mhdMax)} />
            <StatCard label={t('med_days_short')} value={String(last90?.totals?.acuteMedicationDays ?? 0)} />
          </div>
          {(last90 as any)?.totals?.coverage && (
            <div className="mt-2 text-xs text-slate-500">
              {t('coverage', {
                recorded: (last90 as any).totals.coverage.recordedDays,
                total: (last90 as any).totals.coverage.totalDays,
                missing: (last90 as any).totals.coverage.missingDays,
              })}
            </div>
          )}
        </div>
      </div>

      {/* Monthly trend */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-medium text-slate-700">{t('monthly_trend_title')}</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip />
              <Legend />
              <Bar dataKey="meds" name={t('med_days_short')} fill="hsl(204, 94%, 68%)" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="mmd" name="MMD" stroke="hsl(346, 77%, 60%)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t('monthly_trend_summary')}
        </p>
      </div>

      {/* Medication summary */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-medium text-slate-700">{t('medication_summary_title')}</h3>
        {doctorGrade.medicationSummary.length === 0
          ? (
              <p className="text-sm text-slate-500">{t('no_medications_logged')}</p>
            )
          : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">{t('med_name')}</th>
                      <th className="py-2 pr-3">{t('med_uses')}</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {doctorGrade.medicationSummary.slice(0, 10).map((m) => {
                      return (
                        <tr key={m.name} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-medium">{m.name}</td>
                          <td className="py-2 pr-3">{m.uses}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function DoctorGradeQuestionnairesSection({
  doctorGrade,
  t,
}: {
  doctorGrade: ShareData['doctorGrade'] | undefined;
  t: ReturnType<typeof useTranslations<'ShareReport'>>;
}) {
  if (!doctorGrade) {
    return (
      <div className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600">
        {t('doctor_grade_not_available')}
      </div>
    );
  }

  const hit6 = doctorGrade.questionnaires.hit6 ?? [];
  const midas = doctorGrade.questionnaires.midas ?? [];

  const latestHit6 = hit6[0] ?? null;
  const latestMidas = midas[0] ?? null;

  const hit6Trend = hit6
    .slice()
    .reverse()
    .map((r: any) => ({ x: new Date(r.takenAt).toLocaleDateString(), score: r.scoreTotal ?? 0 }));
  const midasTrend = midas
    .slice()
    .reverse()
    .map((r: any) => ({ x: new Date(r.takenAt).toLocaleDateString(), score: r.scoreTotal ?? 0 }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-700">HIT-6</h3>
          <span className="text-xs text-slate-500">
            {latestHit6 ? `${t('latest')}: ${latestHit6.scoreTotal ?? '—'}` : t('not_available')}
          </span>
        </div>
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hit6Trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="x" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis allowDecimals={false} domain={[36, 78]} tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="hsl(234, 100%, 71%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t('questionnaire_trend_note')}
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-700">MIDAS</h3>
          <span className="text-xs text-slate-500">
            {latestMidas
              ? `${t('latest')}: ${latestMidas.scoreTotal ?? '—'} (${latestMidas.scoreDetails?.grade ?? '—'})`
              : t('not_available')}
          </span>
        </div>
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={midasTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="x" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="hsl(346, 77%, 60%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t('questionnaire_trend_note')}
        </p>
      </div>
    </div>
  );
}

function LoadingState({ t }: { t: ReturnType<typeof useTranslations<'ShareReport'>> }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-slate-600">{t('loading')}</p>
      </div>
    </div>
  );
}

function SessionEndedState({ t }: { t: ReturnType<typeof useTranslations<'ShareReport'>> }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100">
          <Lock className="size-8 text-emerald-600" />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-800">{t('session_ended_title')}</h1>
        <p className="text-slate-600">
          {t('session_ended_message')}
        </p>
        <p className="mt-4 text-sm text-slate-500">
          {t('close_tab_message')}
        </p>
      </div>
    </div>
  );
}

function ErrorState({ error, t }: { error: ErrorInfo; t: ReturnType<typeof useTranslations<'ShareReport'>> }) {
  const getErrorDisplay = () => {
    switch (error.code) {
      case 'EXPIRED':
        return {
          icon: <Clock className="size-8 text-amber-600" />,
          title: t('error_expired_title'),
          message: t('error_expired_message'),
          bgColor: 'bg-amber-100',
        };
      case 'REVOKED':
        return {
          icon: <X className="size-8 text-red-600" />,
          title: t('error_revoked_title'),
          message: t('error_revoked_message'),
          bgColor: 'bg-red-100',
        };
      case 'NOT_FOUND':
      case 'INVALID_TOKEN':
        return {
          icon: <AlertTriangle className="size-8 text-slate-600" />,
          title: t('error_invalid_title'),
          message: t('error_invalid_message'),
          bgColor: 'bg-slate-100',
        };
      default:
        return {
          icon: <AlertTriangle className="size-8 text-red-600" />,
          title: t('error_generic_title'),
          message: error.message,
          bgColor: 'bg-red-100',
        };
    }
  };

  const display = getErrorDisplay();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <div className={`mx-auto mb-4 flex size-16 items-center justify-center rounded-full ${display.bgColor}`}>
          {display.icon}
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-800">{display.title}</h1>
        <p className="max-w-sm text-slate-600">{display.message}</p>
      </div>
    </div>
  );
}

function ReportHeader({
  patientName,
  recipientName,
  expiresAt,
  onEndSession,
  currentLocale,
  onLocaleChange,
  t,
}: {
  patientName: string;
  recipientName: string | null;
  expiresAt: string;
  onEndSession: () => void;
  currentLocale: SupportedLanguageType;
  onLocaleChange: (locale: SupportedLanguageType) => void;
  t: ReturnType<typeof useTranslations<'ShareReport'>>;
}) {
  const languageOptions = AppConfig.locales.map(locale => ({
    value: locale.id as SupportedLanguageType,
    label: locale.name,
    flag: locale.flag,
  }));

  return (
    <header className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Shield className="size-4" />
            <span>{t('secure_medical_report')}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">
            {t('migraine_report')}
          </h1>
          <p className="mt-1 text-lg text-slate-600">
            {t('patient_label')}
            {' '}
            {patientName}
          </p>
          {recipientName && (
            <p className="text-sm text-slate-500">
              {t('shared_with_label')}
              {' '}
              {recipientName}
            </p>
          )}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            <Clock className="mr-1 size-3" />
            {t('expires_label')}
            {' '}
            {new Date(expiresAt).toLocaleDateString()}
          </Badge>

          {/* Language Switcher */}
          <div className="flex items-center gap-2 rounded-lg border bg-white px-2 py-1">
            <Globe className="size-4 text-slate-500" />
            <span className="sr-only">{t('language_label')}</span>
            <select
              value={currentLocale}
              onChange={e => onLocaleChange(e.target.value as SupportedLanguageType)}
              className="cursor-pointer border-none bg-transparent py-1 text-sm focus:outline-none focus:ring-0"
              title={t('language_switch_hint')}
            >
              {languageOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.flag}
                  {' '}
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onEndSession}
            className="text-slate-600"
          >
            <X className="mr-1 size-4" />
            {t('end_session')}
          </Button>
        </div>
      </div>

      {/* Confidentiality notice */}
      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>{t('confidential_health_info')}</strong>
            <p className="mt-0.5 text-blue-700">
              {t('confidential_warning')}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function SummarySection({
  summary,
  dateRange,
  t,
}: {
  summary: ShareData['summary'];
  dateRange: ShareData['dateRange'];
  t: ReturnType<typeof useTranslations<'ShareReport'>>;
}) {
  return (
    <div className="space-y-4">
      {/* Date range info */}
      {(dateRange.start || dateRange.end) && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Calendar className="size-4" />
          <span>
            {t('data_from')}
            {' '}
            {dateRange.start
              ? new Date(dateRange.start).toLocaleDateString()
              : t('the_beginning')}
            {' '}
            {t('to')}
            {' '}
            {dateRange.end
              ? new Date(dateRange.end).toLocaleDateString()
              : t('present')}
          </span>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t('total_episodes')}
          value={summary.totalEpisodes.toString()}
          icon={<FileText className="size-5" />}
        />
        <MetricCard
          label={t('this_month')}
          value={summary.episodesThisMonth.toString()}
          icon={<Calendar className="size-5" />}
        />
        <MetricCard
          label={t('avg_intensity')}
          value={`${summary.averageIntensity}/5`}
          icon={<Zap className="size-5" />}
          highlight={summary.averageIntensity >= 4}
        />
        <MetricCard
          label={t('avg_duration')}
          value={
            summary.averageDurationMinutes
              ? formatDuration(summary.averageDurationMinutes)
              : 'N/A'
          }
          icon={<Clock className="size-5" />}
        />
      </div>

      {/* Common patterns */}
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.mostCommonTrigger && (
          <PatternCard
            label={t('most_common_trigger')}
            value={formatTrigger(summary.mostCommonTrigger, t)}
          />
        )}
        {summary.mostCommonSymptom && (
          <PatternCard
            label={t('most_common_symptom')}
            value={formatSymptom(summary.mostCommonSymptom, t)}
          />
        )}
        {summary.mostCommonMedication && (
          <PatternCard
            label={t('most_used_medication')}
            value={summary.mostCommonMedication}
            icon={<Pill className="size-4" />}
          />
        )}
      </div>

      {/* Trend chart */}
      {summary.weeklyTrend.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-4 font-medium text-slate-700">8-Week Trend</h3>
          <div className="h-48 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="week"
                  tickFormatter={val => formatWeekLabel(val)}
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0]?.payload;
                      return (
                        <div className="rounded-lg bg-white p-2 shadow-lg">
                          <p className="text-xs text-slate-500">
                            Week of
                            {' '}
                            {new Date(d.week).toLocaleDateString()}
                          </p>
                          <p className="font-medium">
                            {d.count}
                            {' '}
                            episode(s)
                          </p>
                          <p className="text-sm text-slate-600">
                            Avg intensity:
                            {' '}
                            {d.avgIntensity}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="hsl(234, 100%, 71%)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Intensity trend line */}
          <h3 className="mb-4 mt-6 font-medium text-slate-700">Intensity Trend</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="week"
                  tickFormatter={val => formatWeekLabel(val)}
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                />
                <YAxis
                  domain={[0, 10]}
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0]?.payload;
                      return (
                        <div className="rounded-lg bg-white p-2 shadow-lg">
                          <p className="text-xs text-slate-500">
                            Week of
                            {' '}
                            {new Date(d.week).toLocaleDateString()}
                          </p>
                          <p className="font-medium">
                            Avg intensity:
                            {' '}
                            {d.avgIntensity}
                            /5
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avgIntensity"
                  stroke="hsl(234, 100%, 71%)"
                  strokeWidth={2}
                  dot={{ fill: 'hsl(234, 100%, 71%)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 shadow-sm ${
        highlight ? 'bg-red-50' : 'bg-white'
      }`}
    >
      <div className={`mb-2 ${highlight ? 'text-red-600' : 'text-slate-400'}`}>
        {icon}
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`text-2xl font-bold ${
          highlight ? 'text-red-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PatternCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 flex items-center gap-2 font-medium text-slate-800">
        {icon}
        {value}
      </p>
    </div>
  );
}

function EpisodesList({ episodes, t }: { episodes: SharedEpisode[]; t: ReturnType<typeof useTranslations<'ShareReport'>> }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'severe'>('all');

  const filteredEpisodes
    = filter === 'severe'
      ? episodes.filter(ep => (ep.intensity ?? 0) >= 4)
      : episodes;

  return (
    <div>
      {/* Filter controls */}
      <div className="mb-4 flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          {t('filter_all')}
          {' '}
          (
          {episodes.length}
          )
        </Button>
        <Button
          variant={filter === 'severe' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('severe')}
        >
          {t('filter_severe')}
          {' '}
          (
          {episodes.filter(ep => (ep.intensity ?? 0) >= 4).length}
          )
        </Button>
      </div>

      {/* Episodes list */}
      <div className="space-y-3">
        {filteredEpisodes.length === 0
          ? (
              <p className="py-8 text-center text-slate-500">{t('no_episodes')}</p>
            )
          : (
              filteredEpisodes.map(episode => (
                <EpisodeCard
                  key={episode.id}
                  episode={episode}
                  isExpanded={expandedId === episode.id}
                  onToggle={() =>
                    setExpandedId(expandedId === episode.id ? null : episode.id)}
                  t={t}
                />
              ))
            )}
      </div>
    </div>
  );
}

function EpisodeCard({
  episode,
  isExpanded,
  onToggle,
  t,
}: {
  episode: SharedEpisode;
  isExpanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations<'ShareReport'>>;
}) {
  const startDate = new Date(episode.startTime);
  const endDate = episode.endTime ? new Date(episode.endTime) : null;
  const duration = endDate
    ? Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60))
    : null;

  const painLevel = normalizeToPainLevel(episode.intensity);
  const getIntensityColor = (level: number | null) => {
    if (!level) {
      return 'bg-slate-400';
    }
    if (level <= 2) {
      return 'bg-emerald-500';
    }
    if (level === 3) {
      return 'bg-amber-500';
    }
    if (level === 4) {
      return 'bg-orange-500';
    }
    return 'bg-red-500';
  };

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Card header - always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50"
        aria-expanded={isExpanded}
      >
        {/* Intensity indicator */}
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-full ${getIntensityColor(painLevel)}`}
        >
          <span className="text-lg font-bold text-white">
            {painLevel ? painLevelDisplay(painLevel) : '—'}
          </span>
        </div>

        {/* Summary info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">
              {startDate.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <Badge variant="secondary" className="bg-slate-100 text-slate-700">
              {episode.attackType === 'migraine' ? t('attack_type_migraine') : t('attack_type_headache')}
            </Badge>
            {episode.isOngoing && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                {t('ongoing')}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            <PainLevelBadge value={episode.intensity} className="mr-2 inline-flex align-middle" />
            <span className="align-middle">{t('pain_suffix')}</span>
            {duration ? `, ${formatDuration(duration)}` : ''}
            {episode.medicationIntakes.length > 0
              && t('took_medication', {
                medication: episode.medicationIntakes[0]?.label ?? '',
              })}
          </p>
        </div>

        {/* Expand/collapse icon */}
        <div className="text-slate-400">
          {isExpanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50 p-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {/* Time details */}
            <div>
              <h4 className="font-medium text-slate-700">{t('time_label')}</h4>
              <p className="text-slate-600">
                {t('started_label')}
                {' '}
                {startDate.toLocaleString()}
              </p>
              {endDate && (
                <p className="text-slate-600">
                  {t('ended_label')}
                  {' '}
                  {endDate.toLocaleString()}
                </p>
              )}
              {duration && (
                <p className="text-slate-600">
                  {t('duration_label')}
                  {' '}
                  {formatDuration(duration)}
                </p>
              )}
            </div>

            {/* Pain details */}
            <div>
              <h4 className="font-medium text-slate-700">{t('pain_label')}</h4>
              <p className="text-slate-600">
                {t('intensity_label')}
                {' '}
                <PainLevelBadge value={episode.intensity} className="ml-1 inline-flex align-middle" />
              </p>
              <p className="text-slate-600">
                {t('location_label')}
                {' '}
                {formatPainLocation(episode.painLocation, t)}
                {episode.painLocationOther && ` (${episode.painLocationOther})`}
              </p>
              <p className="text-slate-600">
                {t('type_label')}
                {' '}
                {formatPainType(episode.painType, t)}
                {episode.painTypeOther && ` (${episode.painTypeOther})`}
              </p>
            </div>

            {/* Symptoms */}
            {episode.symptoms.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700">{t('symptoms_label')}</h4>
                <div className="mt-1 flex flex-wrap gap-1">
                  {episode.symptoms.map(symptom => (
                    <Badge key={symptom} variant="secondary">
                      {formatSymptom(symptom, t)}
                    </Badge>
                  ))}
                  {episode.symptomsOther && (
                    <Badge variant="secondary">{episode.symptomsOther}</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Triggers */}
            {episode.triggers.length > 0 && (
              <div>
                <h4 className="font-medium text-slate-700">{t('triggers_label')}</h4>
                <div className="mt-1 flex flex-wrap gap-1">
                  {episode.triggers.map(trigger => (
                    <Badge key={trigger} variant="outline">
                      {formatTrigger(trigger, t)}
                    </Badge>
                  ))}
                  {episode.triggersOther && (
                    <Badge variant="outline">{episode.triggersOther}</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Medication intakes */}
            {episode.medicationIntakes.length > 0 && (
              <div className="sm:col-span-2">
                <h4 className="font-medium text-slate-700">{t('medication_intakes_label')}</h4>
                <ul className="mt-1 space-y-1">
                  {episode.medicationIntakes.map(mi => (
                    <li key={`${mi.label}-${mi.takenAt}`} className="flex items-center gap-2 text-slate-600">
                      <Pill className="size-4 text-slate-400" />
                      {mi.label}
                      {mi.dose && ` (${[mi.dose, mi.unit].filter(Boolean).join(' ')})`}
                      {mi.takenAt
                        && ` at ${new Date(mi.takenAt).toLocaleTimeString()}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Notes */}
            {episode.notes && (
              <div className="sm:col-span-2">
                <h4 className="font-medium text-slate-700">{t('notes_label')}</h4>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">
                  {episode.notes}
                </p>
              </div>
            )}

            {/* Weather context */}
            {episode.weatherContext && (
              <div className="sm:col-span-2">
                <h4 className="font-medium text-slate-700">{t('weather_at_start')}</h4>
                <p className="text-slate-600">
                  {t('wpi_label')}
                  {' '}
                  {episode.weatherContext.wpiScore.toFixed(1)}
                  /10 (
                  {episode.weatherContext.wpiLevel}
                  )
                </p>
                <p className="text-xs text-slate-500">
                  {t('delta_pressure')}
                  {' '}
                  {episode.weatherContext.deltaPressure.toFixed(1)}
                  {' '}
                  hPa,
                  {t('humidity_label')}
                  {' '}
                  {episode.weatherContext.humidity.toFixed(0)}
                  %
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Utility functions
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatWeekLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPainLocation(location: string, t: ReturnType<typeof useTranslations<'ShareReport'>>): string {
  const map: Record<string, string> = {
    LEFT: t('pain_location_left'),
    RIGHT: t('pain_location_right'),
    FRONTAL: t('pain_location_frontal'),
    OCCIPITAL: t('pain_location_occipital'),
    WHOLE_HEAD: t('pain_location_whole_head'),
    OTHER: t('pain_location_other'),
  };
  return map[location] || location;
}

function formatPainType(type: string, t: ReturnType<typeof useTranslations<'ShareReport'>>): string {
  const map: Record<string, string> = {
    THROBBING: t('pain_type_throbbing'),
    STABBING: t('pain_type_stabbing'),
    PRESSURE: t('pain_type_pressure'),
    BURNING: t('pain_type_burning'),
    OTHER: t('pain_type_other'),
  };
  return map[type] || type;
}

function formatSymptom(symptom: string, t: ReturnType<typeof useTranslations<'ShareReport'>>): string {
  const map: Record<string, string> = {
    NAUSEA: t('symptom_nausea'),
    VOMITING: t('symptom_vomiting'),
    PHOTOPHOBIA: t('symptom_photophobia'),
    PHONOPHOBIA: t('symptom_phonophobia'),
    AURA: t('symptom_aura'),
    DIZZINESS: t('symptom_dizziness'),
    NECK_PAIN: t('symptom_neck_pain'),
    OTHER: t('symptom_other'),
  };
  return map[symptom] || symptom;
}

function formatTrigger(trigger: string, t: ReturnType<typeof useTranslations<'ShareReport'>>): string {
  const map: Record<string, string> = {
    STRESS: t('trigger_stress'),
    SLEEP_ISSUE: t('trigger_sleep_issue'),
    FOOD: t('trigger_food'),
    SKIPPED_MEAL: t('trigger_skipped_meal'),
    DEHYDRATION: t('trigger_dehydration'),
    CAFFEINE: t('trigger_caffeine'),
    ALCOHOL: t('trigger_alcohol'),
    HORMONES: t('trigger_hormones'),
    SCREEN_TIME: t('trigger_screen_time'),
    WEATHER: t('trigger_weather'),
    EXERCISE: t('trigger_exercise'),
    OTHER: t('trigger_other'),
  };
  return map[trigger] || trigger;
}
