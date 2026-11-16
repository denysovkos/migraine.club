'use client';

import type { DoctorVerificationApplicationDto } from '@/types/DoctorVerification';
import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type FormState = {
  fullName: string;
  country: string;
  specialty: 'neurologist' | 'gp' | 'pain_specialist' | 'other';
  verificationMethod: 'license_number' | 'clinic_email' | 'document_upload';
  licenseNumber: string;
  clinicEmail: string;
  applicantStatementAccepted: boolean;
};

export function DoctorVerificationSettings() {
  const t = useTranslations('DoctorVerification');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<DoctorVerificationApplicationDto | null>(null);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);

  const [form, setForm] = useState<FormState>({
    fullName: '',
    country: '',
    specialty: 'other',
    verificationMethod: 'license_number',
    licenseNumber: '',
    clinicEmail: '',
    applicantStatementAccepted: false,
  });

  const isApproved = application?.status === 'approved';
  const isPendingSubmitted = application?.status === 'pending' && !!application?.submittedAt;
  const isRejected = application?.status === 'rejected';

  const canEdit = !isApproved;

  const requiresLicenseNumber = form.verificationMethod === 'license_number';
  const requiresClinicEmail = form.verificationMethod === 'clinic_email';
  const requiresUpload = form.verificationMethod === 'document_upload';

  const DISCLAIMERS = useMemo(() => ([
    t('disclaimer_1'),
    t('disclaimer_2'),
    t('disclaimer_3'),
  ]), [t]);

  function specialtyLabel(s: FormState['specialty']) {
    switch (s) {
      case 'neurologist':
        return t('specialty_neurologist');
      case 'gp':
        return t('specialty_gp');
      case 'pain_specialist':
        return t('specialty_pain_specialist');
      case 'other':
        return t('specialty_other');
    }
  }

  function methodLabel(m: FormState['verificationMethod']) {
    switch (m) {
      case 'license_number':
        return t('method_license_number');
      case 'clinic_email':
        return t('method_clinic_email');
      case 'document_upload':
        return t('method_document_upload');
    }
  }

  const submitDisabledReason = useMemo(() => {
    if (!form.fullName.trim()) {
      return t('validation_full_name_required');
    }
    if (!form.country.trim()) {
      return t('validation_country_required');
    }
    if (!form.applicantStatementAccepted) {
      return t('validation_statement_required');
    }
    if (requiresLicenseNumber && !form.licenseNumber.trim()) {
      return t('validation_license_number_required');
    }
    if (requiresClinicEmail && !form.clinicEmail.trim()) {
      return t('validation_clinic_email_required');
    }
    if (requiresUpload && !(application?.file)) {
      return t('validation_upload_required');
    }
    return null;
  }, [application?.file, form, requiresClinicEmail, requiresLicenseNumber, requiresUpload, t]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/doctor-verification/application');
      const data = await res.json();
      setApplication(data.application ?? null);

      if (data.application) {
        const app: DoctorVerificationApplicationDto = data.application;
        setForm({
          fullName: app.fullName ?? '',
          country: app.country ?? '',
          specialty: (app.specialty as any) ?? 'other',
          verificationMethod: (app.verificationMethod as any) ?? 'license_number',
          licenseNumber: app.licenseNumber ?? '',
          clinicEmail: app.clinicEmail ?? '',
          applicantStatementAccepted: !!app.applicantStatementAccepted,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveDraft(opts?: { reapply?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const qs = opts?.reapply ? '?reapply=true' : '';
      const res = await fetch(`/api/doctor-verification/application${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          country: form.country,
          specialty: form.specialty,
          verificationMethod: form.verificationMethod,
          licenseNumber: requiresLicenseNumber ? form.licenseNumber : null,
          clinicEmail: requiresClinicEmail ? form.clinicEmail : null,
          applicantStatementAccepted: form.applicantStatementAccepted,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? t('error_save_failed'));
      }
      setApplication(data.application ?? null);
    } finally {
      setSaving(false);
    }
  }

  async function submit(reapply: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/doctor-verification/application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          country: form.country,
          specialty: form.specialty,
          verificationMethod: form.verificationMethod,
          licenseNumber: requiresLicenseNumber ? form.licenseNumber : null,
          clinicEmail: requiresClinicEmail ? form.clinicEmail : null,
          applicantStatementAccepted: form.applicantStatementAccepted,
          reapply,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? t('error_submit_failed'));
      }
      setApplication(data.application ?? null);
    } finally {
      setSubmitting(false);
    }
  }

  async function upload() {
    if (!fileToUpload) {
      setError(t('validation_choose_file_first'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      // Ensure draft exists so we have an applicationId
      if (!application || isRejected) {
        await saveDraft({ reapply: isRejected });
      }

      const fd = new FormData();
      fd.set('file', fileToUpload);

      const res = await fetch('/api/doctor-verification/upload', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? t('error_upload_failed'));
      }
      setFileToUpload(null);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/20 p-4 text-sm">
        <div className="mb-2 font-medium">{t('important_title')}</div>
        <ul className="list-disc space-y-1 pl-5">
          {DISCLAIMERS.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {application?.status === 'approved' && (
        <div className="rounded-lg border bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          {t('status_verified_badge')}
          {' '}
          •
          {' '}
          {specialtyLabel(form.specialty)}
        </div>
      )}

      {application?.status === 'pending' && application.submittedAt && (
        <div className="rounded-lg border bg-blue-500/10 p-4 text-sm text-blue-700 dark:text-blue-300">
          {t('status_pending')}
        </div>
      )}

      {application?.status === 'rejected' && (
        <div className="rounded-lg border bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          {t('status_rejected')}
          {application.userFacingNote && (
            <div className="mt-2 text-xs text-muted-foreground">
              {t('note_label')}
              {' '}
              {application.userFacingNote}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-3">
          <label htmlFor="doctor-verification-full-name" className="text-sm font-medium">{t('full_name_label')}</label>
          <Input
            id="doctor-verification-full-name"
            value={form.fullName}
            onChange={e => setForm(s => ({ ...s, fullName: e.target.value }))}
            disabled={!canEdit}
          />
        </div>

        <div className="grid gap-3">
          <label htmlFor="doctor-verification-country" className="text-sm font-medium">{t('country_label')}</label>
          <Input
            id="doctor-verification-country"
            value={form.country}
            onChange={e => setForm(s => ({ ...s, country: e.target.value }))}
            placeholder={t('country_placeholder')}
            disabled={!canEdit}
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="doctor-verification-specialty" className="text-sm font-medium">{t('specialty_label')}</label>
          <select
            id="doctor-verification-specialty"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.specialty}
            onChange={e => setForm(s => ({ ...s, specialty: e.target.value as any }))}
            disabled={!canEdit}
          >
            <option value="neurologist">{specialtyLabel('neurologist')}</option>
            <option value="gp">{specialtyLabel('gp')}</option>
            <option value="pain_specialist">{specialtyLabel('pain_specialist')}</option>
            <option value="other">{specialtyLabel('other')}</option>
          </select>
        </div>

        <div className="grid gap-2">
          <label htmlFor="doctor-verification-method" className="text-sm font-medium">{t('method_label')}</label>
          <select
            id="doctor-verification-method"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.verificationMethod}
            onChange={e =>
              setForm(s => ({
                ...s,
                verificationMethod: e.target.value as any,
              }))}
            disabled={!canEdit}
          >
            <option value="license_number">{methodLabel('license_number')}</option>
            <option value="clinic_email">{methodLabel('clinic_email')}</option>
            <option value="document_upload">{methodLabel('document_upload')}</option>
          </select>
        </div>

        {requiresLicenseNumber && (
          <div className="grid gap-2">
            <label htmlFor="doctor-verification-license-number" className="text-sm font-medium">{t('license_number_label')}</label>
            <Input
              id="doctor-verification-license-number"
              value={form.licenseNumber}
              onChange={e => setForm(s => ({ ...s, licenseNumber: e.target.value }))}
              disabled={!canEdit}
            />
          </div>
        )}

        {requiresClinicEmail && (
          <div className="grid gap-2">
            <label htmlFor="doctor-verification-clinic-email" className="text-sm font-medium">{t('clinic_email_label')}</label>
            <Input
              id="doctor-verification-clinic-email"
              value={form.clinicEmail}
              onChange={e => setForm(s => ({ ...s, clinicEmail: e.target.value }))}
              placeholder={t('clinic_email_placeholder')}
              disabled={!canEdit}
            />
          </div>
        )}

        {requiresUpload && (
          <div className="rounded-lg border p-4">
            <div className="mb-2 text-sm font-medium">{t('upload_title')}</div>
            <div className="text-xs text-muted-foreground">
              {t('upload_help')}
            </div>

            {application?.file && (
              <div className="mt-3 rounded-md bg-muted p-3 text-xs">
                {t('uploaded_label')}
                {' '}
                <span className="font-medium">{application.file.originalName}</span>
                {' '}
                (
                {Math.round(application.file.sizeBytes / 1024)}
                {' '}
                {t('kb')}
                )
                <div className="mt-2">
                  <a
                    className="text-primary hover:underline"
                    href={`/api/doctor-verification/files/${application.file.id}`}
                  >
                    {t('download')}
                  </a>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={e => setFileToUpload(e.target.files?.[0] ?? null)}
                disabled={!canEdit || uploading}
              />
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                onClick={upload}
                disabled={!canEdit || uploading || !fileToUpload}
              >
                {uploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
                {application?.file ? t('replace_file') : t('upload_file')}
              </Button>
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={form.applicantStatementAccepted}
            onChange={e => setForm(s => ({ ...s, applicantStatementAccepted: e.target.checked }))}
            disabled={!canEdit}
          />
          <span>
            {t('statement')}
          </span>
        </label>

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            onClick={() => saveDraft({ reapply: isRejected })}
            disabled={!canEdit || saving}
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('save')}
          </Button>

          <Button
            type="button"
            className="min-h-[44px]"
            onClick={() => submit(isRejected)}
            disabled={!canEdit || submitting || !!submitDisabledReason}
            title={submitDisabledReason ?? undefined}
          >
            {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {isRejected ? t('reapply') : (isPendingSubmitted ? t('update_submission') : t('submit_for_verification'))}
          </Button>
        </div>
      </div>
    </div>
  );
}
