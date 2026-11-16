'use client';

import { AlertTriangle, CheckCircle, Download, FileText, Shield, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DashboardSection } from '@/features/dashboard/DashboardSection';

type ConsentRecord = {
  version: string;
  givenAt: string;
};

type Consents = {
  health_data?: ConsentRecord;
  terms?: ConsentRecord;
  privacy?: ConsentRecord;
  analytics?: ConsentRecord;
};

export default function PrivacySettingsPage() {
  const t = useTranslations('PrivacySettings');
  const router = useRouter();
  const [consents, setConsents] = useState<Consents>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isAcceptingTerms, setIsAcceptingTerms] = useState(false);
  const [termsSuccess, setTermsSuccess] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchConsents = async () => {
    try {
      const response = await fetch('/api/user/consent');
      if (response.ok) {
        const data = await response.json();
        setConsents(data.consents || {});
      }
    } catch (error) {
      console.error('Failed to fetch consents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConsents();
  }, []);

  const handleAcceptTerms = async () => {
    setIsAcceptingTerms(true);
    setTermsSuccess(false);
    setTermsError(null);
    try {
      const response = await fetch('/api/user/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentType: 'terms',
          version: '1.0',
        }),
      });

      if (response.ok) {
        setTermsSuccess(true);
        // Refresh consents
        await fetchConsents();
        // Clear success message after a delay
        setTimeout(setTermsSuccess, 3000, false);
      } else {
        const data = await response.json();
        setTermsError(data.error || t('terms_accept_error'));
      }
    } catch (error) {
      console.error('Failed to accept terms:', error);
      setTermsError(t('terms_accept_error'));
    } finally {
      setIsAcceptingTerms(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch('/api/user/delete-account', {
        method: 'DELETE',
      });

      if (response.ok) {
        // Redirect to home page after deletion
        router.push('/');
      } else {
        const data = await response.json();
        setDeleteError(data.error || t('delete_error'));
      }
    } catch (error) {
      console.error('Failed to delete account:', error);
      setDeleteError(t('delete_error'));
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Consent Status */}
      <DashboardSection
        title={(
          <span className="flex items-center gap-2">
            <Shield className="size-5" />
            {t('consent_status_title')}
          </span>
        )}
        description={t('consent_status_description')}
      >
        {isLoading
          ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            )
          : (
              <div className="space-y-4">
                {/* Health Data Consent */}
                <div className="flex items-start justify-between rounded-lg border p-4">
                  <div>
                    <h4 className="font-medium">{t('health_data_consent')}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('health_data_consent_description')}
                    </p>
                    {consents.health_data && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('consented_on')}
                        {': '}
                        {formatDate(consents.health_data.givenAt)}
                        {' (v'}
                        {consents.health_data.version}
                        )
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                    consents.health_data
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                  >
                    {consents.health_data ? t('status_active') : t('status_pending')}
                  </span>
                </div>

                {/* Terms Acceptance */}
                <div className="flex items-start justify-between rounded-lg border p-4">
                  <div className="flex-1">
                    <h4 className="font-medium">{t('terms_acceptance')}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('terms_acceptance_description')}
                    </p>
                    {consents.terms && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('accepted_on')}
                        {': '}
                        {formatDate(consents.terms.givenAt)}
                      </p>
                    )}
                    {!consents.terms && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-muted-foreground">
                          {t('terms_review_note')}
                          {' '}
                          <Link href="/terms" className="text-primary hover:underline">
                            {t('view_terms')}
                          </Link>
                          {' · '}
                          <Link href="/privacy" className="text-primary hover:underline">
                            {t('view_privacy_policy')}
                          </Link>
                        </p>
                        <Button
                          size="sm"
                          onClick={handleAcceptTerms}
                          disabled={isAcceptingTerms}
                        >
                          {isAcceptingTerms ? t('accepting_terms') : t('accept_terms_button')}
                        </Button>
                        {termsSuccess && (
                          <span className="ml-2 inline-flex items-center gap-1 text-sm text-green-600">
                            <CheckCircle className="size-4" />
                            {t('terms_accepted_success')}
                          </span>
                        )}
                        {termsError && (
                          <span className="mt-2 block text-sm text-destructive">
                            {termsError}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                    consents.terms
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                  >
                    {consents.terms ? t('status_accepted') : t('status_pending')}
                  </span>
                </div>
              </div>
            )}
      </DashboardSection>

      {/* Legal Documents */}
      <DashboardSection
        title={(
          <span className="flex items-center gap-2">
            <FileText className="size-5" />
            {t('legal_documents_title')}
          </span>
        )}
        description={t('legal_documents_description')}
      >
        <div className="flex flex-wrap gap-3">
          <Link
            href="/privacy"
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <FileText className="size-4" />
            {t('view_privacy_policy')}
          </Link>
          <Link
            href="/terms"
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <FileText className="size-4" />
            {t('view_terms')}
          </Link>
        </div>
      </DashboardSection>

      {/* Data Export (placeholder) */}
      <DashboardSection
        title={(
          <span className="flex items-center gap-2">
            <Download className="size-5" />
            {t('data_export_title')}
          </span>
        )}
        description={t('data_export_description')}
      >
        <Button variant="outline" disabled>
          <Download className="mr-2 size-4" />
          {t('export_button')}
          {' '}
          <span className="ml-1 text-xs text-muted-foreground">
            (
            {t('coming_soon')}
            )
          </span>
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('data_export_note')}
        </p>
      </DashboardSection>

      {/* Delete Account */}
      <DashboardSection
        title={(
          <span className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-5" />
            {t('delete_account_title')}
          </span>
        )}
        description={t('delete_account_description')}
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">
                {t('delete_warning_title')}
              </p>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li>{t('delete_warning_item1')}</li>
                <li>{t('delete_warning_item2')}</li>
                <li>{t('delete_warning_item3')}</li>
                <li>{t('delete_warning_item4')}</li>
              </ul>
              {deleteError && (
                <p className="mt-2 text-sm text-destructive">{deleteError}</p>
              )}
            </div>
          </div>

          {!showDeleteConfirm
            ? (
                <Button
                  variant="destructive"
                  className="mt-4"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  {t('delete_button')}
                </Button>
              )
            : (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium">{t('delete_confirm_message')}</p>
                  <div className="flex gap-3">
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={isDeleting}
                    >
                      {isDeleting ? t('deleting') : t('delete_confirm_button')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
        </div>
      </DashboardSection>
    </div>
  );
}
