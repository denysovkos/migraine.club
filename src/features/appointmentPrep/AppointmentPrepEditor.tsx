'use client';

import type { AppointmentPrepDraft } from './appointmentPrepApi';
import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardSection } from '@/features/dashboard/DashboardSection';

import { showSnackbar } from '@/features/snackbar';
import {
  createAppointmentPrepShareLink,
  exportAppointmentPrepPdf,
  getAppointmentPrep,
  updateAppointmentPrep,
} from './appointmentPrepApi';

function linesToList(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function listToLines(value: string[] | null | undefined) {
  return (value ?? []).join('\n');
}

function downloadBlob(args: { blob: Blob; filename: string }) {
  const href = URL.createObjectURL(args.blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

type DraftState = AppointmentPrepDraft & {
  topConcernsText: string;
  doctorQuestionsText: string;
};

type SnapshotMessageKey
  = | 'coverage_summary'
    | 'attack_summary'
    | 'treatment_adjustment'
    | 'acute_medication_safety';

const WHAT_CHANGED_TRANSLATION_KEYS: Record<'coverage_summary' | 'attack_summary', SnapshotMessageKey> = {
  coverage_summary: 'coverage_summary',
  attack_summary: 'attack_summary',
};

const QUESTION_PROMPT_TRANSLATION_KEYS: Record<'treatment_adjustment' | 'acute_medication_safety', SnapshotMessageKey> = {
  treatment_adjustment: 'treatment_adjustment',
  acute_medication_safety: 'acute_medication_safety',
};

function toDraftState(draft: AppointmentPrepDraft): DraftState {
  return {
    ...draft,
    topConcernsText: listToLines(draft.topConcerns),
    doctorQuestionsText: listToLines(draft.doctorQuestions),
  };
}

function isWhatChangedKey(value: string): value is keyof typeof WHAT_CHANGED_TRANSLATION_KEYS {
  return value in WHAT_CHANGED_TRANSLATION_KEYS;
}

function isQuestionPromptKey(value: string): value is keyof typeof QUESTION_PROMPT_TRANSLATION_KEYS {
  return value in QUESTION_PROMPT_TRANSLATION_KEYS;
}

export function AppointmentPrepEditor({ prepId }: { prepId: string }) {
  const t = useTranslations('AppointmentPrep');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningAction, setRunningAction] = useState<null | 'share' | 'pdf'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getAppointmentPrep(prepId)
      .then((nextDraft) => {
        if (!active) {
          return;
        }
        setDraft(toDraftState(nextDraft));
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setError(t('load_error'));
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [prepId, t]);

  async function handleSave() {
    if (!draft || saving || runningAction) {
      return;
    }

    setSaving(true);
    try {
      const updated = await updateAppointmentPrep(prepId, {
        appointmentDate: draft.appointmentDate,
        visitLabel: draft.visitLabel,
        clinicianName: draft.clinicianName,
        visitReason: draft.visitReason,
        topConcerns: linesToList(draft.topConcernsText),
        doctorQuestions: linesToList(draft.doctorQuestionsText),
        personalNotes: draft.personalNotes,
      });
      setDraft(toDraftState(updated));
      showSnackbar({ message: t('saved') });
    } catch {
      showSnackbar({ message: t('save_error') });
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    if (saving || runningAction) {
      return;
    }

    setRunningAction('share');
    try {
      const shareUrl = await createAppointmentPrepShareLink(prepId);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl).catch(() => undefined);
      }
      showSnackbar({ message: t('share_ready') });
    } catch {
      showSnackbar({ message: t('share_error') });
    } finally {
      setRunningAction(null);
    }
  }

  async function handlePdfExport() {
    if (!draft || saving || runningAction) {
      return;
    }

    setRunningAction('pdf');
    try {
      const blob = await exportAppointmentPrepPdf(prepId);
      downloadBlob({
        blob,
        filename: `Migrennity_Appointment_Prep_${draft.appointmentDate}.pdf`,
      });
      showSnackbar({ message: t('pdf_ready') });
    } catch {
      showSnackbar({ message: t('pdf_error') });
    } finally {
      setRunningAction(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('empty_state')}
      </div>
    );
  }

  const { generatedSnapshot } = draft;
  const actionBusy = saving || runningAction !== null;

  return (
    <div className="space-y-4">
      <DashboardSection title={t('visit_details_title')} description={t('visit_details_description')}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="appointment_date" className="text-sm font-medium">
              {t('appointment_date')}
            </label>
            <Input
              id="appointment_date"
              type="date"
              value={draft.appointmentDate}
              onChange={e => setDraft(prev => (prev ? { ...prev, appointmentDate: e.target.value } : prev))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="visit_label" className="text-sm font-medium">
              {t('visit_label')}
            </label>
            <Input
              id="visit_label"
              value={draft.visitLabel ?? ''}
              onChange={e => setDraft(prev => (prev ? { ...prev, visitLabel: e.target.value } : prev))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="clinician_name" className="text-sm font-medium">
              {t('clinician_name')}
            </label>
            <Input
              id="clinician_name"
              value={draft.clinicianName ?? ''}
              onChange={e => setDraft(prev => (prev ? { ...prev, clinicianName: e.target.value } : prev))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="visit_reason" className="text-sm font-medium">
              {t('visit_reason')}
            </label>
            <Input
              id="visit_reason"
              value={draft.visitReason ?? ''}
              onChange={e => setDraft(prev => (prev ? { ...prev, visitReason: e.target.value } : prev))}
            />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title={t('patient_notes_title')} description={t('patient_notes_description')}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="top_concerns" className="text-sm font-medium">
              {t('top_concerns')}
            </label>
            <textarea
              id="top_concerns"
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={draft.topConcernsText}
              onChange={e => setDraft(prev => (prev ? { ...prev, topConcernsText: e.target.value } : prev))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="doctor_questions" className="text-sm font-medium">
              {t('doctor_questions')}
            </label>
            <textarea
              id="doctor_questions"
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={draft.doctorQuestionsText}
              onChange={e => setDraft(prev => (prev ? { ...prev, doctorQuestionsText: e.target.value } : prev))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="personal_notes" className="text-sm font-medium">
              {t('personal_notes')}
            </label>
            <textarea
              id="personal_notes"
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={draft.personalNotes ?? ''}
              onChange={e => setDraft(prev => (prev ? { ...prev, personalNotes: e.target.value } : prev))}
            />
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title={t('snapshot_title')} description={t('snapshot_description')}>
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium">{t('what_changed')}</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {generatedSnapshot.whatChangedKeys.map(key => (
                <li key={key}>
                  {isWhatChangedKey(key) ? t(WHAT_CHANGED_TRANSLATION_KEYS[key]) : key}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">{t('current_snapshot')}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('migraine_days')}</div>
                <div className="text-muted-foreground">{generatedSnapshot.currentSnapshot.headacheBurden.migraineDays}</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('headache_days')}</div>
                <div className="text-muted-foreground">{generatedSnapshot.currentSnapshot.headacheBurden.headacheDays}</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('acute_medication_days')}</div>
                <div className="text-muted-foreground">{generatedSnapshot.currentSnapshot.acuteMedicationDays}</div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('preventives')}</div>
                <div className="text-muted-foreground">
                  {generatedSnapshot.currentSnapshot.preventiveNames.length > 0
                    ? generatedSnapshot.currentSnapshot.preventiveNames.join(', ')
                    : t('none')}
                </div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('hit6')}</div>
                <div className="text-muted-foreground">
                  {generatedSnapshot.currentSnapshot.questionnaireScores.hit6 ?? t('none')}
                </div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="font-medium">{t('midas')}</div>
                <div className="text-muted-foreground">
                  {generatedSnapshot.currentSnapshot.questionnaireScores.midas ?? t('none')}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">{t('questions_to_ask')}</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {generatedSnapshot.questionPromptKeys.map(key => (
                <li key={key}>
                  {isQuestionPromptKey(key) ? t(QUESTION_PROMPT_TRANSLATION_KEYS[key]) : key}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DashboardSection>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={actionBusy}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button variant="outline" onClick={() => void handleShare()} disabled={actionBusy}>
          {runningAction === 'share' ? t('share_running') : t('share_cta')}
        </Button>
        <Button variant="outline" onClick={() => void handlePdfExport()} disabled={actionBusy}>
          {runningAction === 'pdf' ? t('pdf_running') : t('pdf_cta')}
        </Button>
      </div>
    </div>
  );
}
